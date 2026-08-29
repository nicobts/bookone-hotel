import { sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { emit } from '../events/emitter'
import { systemActor } from '../events/actor'
import { DATA_MAP, executableRules, type DataMapEntry } from './data-map'

/**
 * The retention sweep (E8.2).
 *
 * One job, driven by the data map rather than by a hand-written list of
 * statements. Adding a table with a period adds a sweep; there is no second
 * place to remember, which is the failure this shape exists to prevent — the
 * retention job that covers eleven of the fourteen tables somebody meant it to.
 *
 * ## Scoped to one property, always
 *
 * Binding rule 3 does not relax under the service role. Every statement below
 * carries `property_id = $1`, so a bug in a predicate destroys at most one
 * hotel's data instead of every hotel's — and so the run is restartable per
 * property when one of them fails.
 *
 * ## Counts, never rows
 *
 * The outcome records how many rows a rule touched and nothing about which.
 * A retention log listing the records it deleted has re-created the data it
 * deleted, in a table with no retention rule of its own.
 *
 * ## Idempotence is a predicate, not a flag
 *
 * A purge rule only matches rows that still hold something to purge — either
 * the stamp is null, or one of the target columns is not yet at its purged
 * value. Without that the same rows are reported every night forever and the
 * count stops meaning anything.
 */

/**
 * Identifiers reach SQL as text, so they are checked before they get there.
 *
 * Everything in the data map is a literal written by us and reviewed in a pull
 * request, which makes this defence-in-depth rather than a control against a
 * live threat. It stays because "the input is trusted" is the sentence at the
 * top of most injection post-mortems, and the cost is one regex.
 */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

function identifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`Refusing to build SQL with "${value}" as an identifier`)
  }

  return value
}

/**
 * The purged value for a column, as SQL.
 *
 * Also a fixed vocabulary from the map: `null`, `false`, a quoted literal, a
 * jsonb cast. Anything outside it is a typo that would otherwise become a
 * fragment of a statement.
 */
const LITERAL = /^(null|false|true|''|'[^'\\;]*'|'(\{\}|\[\])'::jsonb|-?\d+)$/

function literal(value: string): string {
  if (!LITERAL.test(value)) {
    throw new Error(`Refusing to build SQL with "${value}" as a value`)
  }

  return value
}

export interface RetentionResult {
  table: string
  /** `purge-columns` or `delete-rows`, so the log says what happened. */
  rule: string
  affected: number
  /** Set when this rule threw. The message only — never a row. */
  error?: string
}

export interface RetentionOutcome {
  propertyId: string
  results: RetentionResult[]
  /** Sum across rules — the one number worth putting in a log line. */
  total: number
}

export interface RetentionInput {
  propertyId: string
  /**
   * The moment the periods are measured from.
   *
   * Injectable for tests, and only for tests. Production passes nothing and
   * gets the database's clock, because a period computed against the
   * application's clock and compared against a column written by the database's
   * is two clocks — and the difference between them on this machine is around
   * six hundred milliseconds, which has already caused two bugs in this
   * codebase.
   */
  now?: Date
  /** Compute the counts and change nothing. What the runbook's dry run uses. */
  dryRun?: boolean
}

/** `now() - interval 'N days'`, or the caller's clock when a test pins one. */
function cutoff(days: number, now?: Date) {
  return now
    ? sql`${now.toISOString()}::timestamptz - ${sql.raw(`interval '${days} days'`)}`
    : sql`now() - ${sql.raw(`interval '${days} days'`)}`
}

/**
 * The rows a purge rule still has work to do on.
 *
 * With a stamp: the stamp is null. Without one: at least one target column is
 * not yet at its purged value. The second form is why `guests` at ten years
 * does not report the same rows every night for the rest of the decade.
 */
function unpurged(entry: DataMapEntry & { retention: { kind: 'purge-columns' } }) {
  const { retention } = entry

  if (retention.stamp) {
    return sql`${sql.raw(identifier(retention.stamp))} is null`
  }

  const clauses = Object.entries(retention.columns).map(
    ([column, value]) =>
      sql`${sql.raw(identifier(column))} is distinct from ${sql.raw(literal(value))}`,
  )

  return sql.join(clauses, sql` or `)
}

async function purgeColumns(
  input: RetentionInput,
  entry: DataMapEntry & { retention: { kind: 'purge-columns' } },
): Promise<number> {
  const { retention } = entry
  const table = identifier(entry.table)

  const assignments = Object.entries(retention.columns).map(
    ([column, value]) => sql`${sql.raw(identifier(column))} = ${sql.raw(literal(value))}`,
  )

  if (retention.stamp) {
    assignments.push(sql`${sql.raw(identifier(retention.stamp))} = now()`)
  }

  /*
   * `departure` is not a column on the table being purged — it is the end of
   * the stay, and the only table using it is `registration_records`, whose
   * clock has to start when the guest leaves rather than when the form was
   * filled in. Anywhere else this would be a join to write carefully; here it
   * is one relationship, named in the map, and spelling it out beats a generic
   * join builder nobody can read.
   */
  const older =
    retention.anchor === 'departure'
      ? sql`exists (
          select 1 from reservations r
          where r.id = ${sql.raw(table)}.reservation_id
            and r.property_id = ${input.propertyId}
            and r.departure_date < (${cutoff(retention.afterDays, input.now)})::date
        )`
      : sql`${sql.raw(identifier(retention.anchor))} < ${cutoff(retention.afterDays, input.now)}`

  const where = sql`property_id = ${input.propertyId} and (${older}) and (${unpurged(entry)})`

  if (input.dryRun) {
    return count(sql`select count(*)::int as n from ${sql.raw(table)} where ${where}`)
  }

  return count(
    sql`update ${sql.raw(table)} set ${sql.join(assignments, sql`, `)} where ${where} returning 1`,
    'rows',
  )
}

async function deleteRows(
  input: RetentionInput,
  entry: DataMapEntry & { retention: { kind: 'delete-rows' } },
): Promise<number> {
  const { retention } = entry
  const table = identifier(entry.table)
  const older = sql`${sql.raw(identifier(retention.anchor))} < ${cutoff(retention.afterDays, input.now)}`
  const where = sql`property_id = ${input.propertyId} and ${older}`

  if (input.dryRun) {
    return count(sql`select count(*)::int as n from ${sql.raw(table)} where ${where}`)
  }

  /*
   * Dependents first, in the order the map lists them.
   *
   * Three of a reservation's children are `restrict` and one is joined by id
   * with no foreign key at all. Without this the ten-year rule throws on its
   * first non-empty run, having deleted nothing — the failure mode of a
   * scheduled job that only ever runs against an empty table in development.
   */
  for (const dependent of retention.dependents ?? []) {
    const child = identifier(dependent.table)
    const extra = dependent.where ? sql` and ${sql.raw(guardWhere(dependent.where))}` : sql``

    await asService((db) =>
      db.execute(sql`
        delete from ${sql.raw(child)}
        where property_id = ${input.propertyId}${extra}
          and ${sql.raw(identifier(dependent.via))} in (
            select id from ${sql.raw(table)} where ${where}
          )
      `),
    )
  }

  return count(sql`delete from ${sql.raw(table)} where ${where} returning 1`, 'rows')
}

/**
 * The one free-form fragment in the map, kept on a short leash.
 *
 * `external_refs` needs `entity_type = 'reservation'` and nothing else does.
 * Rather than inventing a predicate language for one caller, the shape is
 * pinned: a column, `=`, a quoted literal.
 */
const SIMPLE_PREDICATE = /^[a-z_][a-z0-9_]* = '[a-z_]+'$/

function guardWhere(value: string): string {
  if (!SIMPLE_PREDICATE.test(value)) {
    throw new Error(`Refusing to build SQL with "${value}" as a predicate`)
  }

  return value
}

/** Runs a statement and returns how many rows it touched. */
async function count(statement: ReturnType<typeof sql>, mode: 'n' | 'rows' = 'n'): Promise<number> {
  const result = await asService((db) => db.execute(statement))
  const rows = result as unknown as Record<string, unknown>[]

  if (mode === 'rows') return rows.length

  return Number(rows[0]?.n ?? 0)
}

/**
 * Applies every executable rule to one property.
 *
 * Rules run in map order and independently: one that throws is recorded and the
 * rest still run. A sweep that stops at the first failure leaves the tables
 * after it in the list holding data past its declared period, and the
 * declaration is the thing with the legal weight.
 */
export async function runRetention(input: RetentionInput): Promise<RetentionOutcome> {
  const results: RetentionResult[] = []

  for (const entry of executableRules()) {
    try {
      const affected =
        entry.retention.kind === 'purge-columns'
          ? await purgeColumns(input, entry as never)
          : await deleteRows(input, entry as never)

      results.push({ table: entry.table, rule: entry.retention.kind, affected })
    } catch (error) {
      /*
       * Recorded, and the sweep goes on.
       *
       * Stopping at the first failure leaves every table after it in the list
       * holding data past its declared period — and the declaration is the part
       * with legal weight, so a partial sweep that reports honestly beats a
       * complete one that never finishes.
       */
      results.push({
        table: entry.table,
        rule: entry.retention.kind,
        affected: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const total = results.reduce((sum, result) => sum + result.affected, 0)

  /*
   * Evented, like every other mutation (binding rule 2) — and this is one of
   * the few events somebody outside the company may eventually read. The
   * payload is table names and integers: the evidence that the declared periods
   * are enforced, with nothing in it that the sweep just spent its run removing.
   */
  const notable = results.filter((result) => result.affected > 0 || result.error)

  if (!input.dryRun && notable.length > 0) {
    await asService((db) =>
      db.transaction((tx) =>
        emit(tx, {
          propertyId: input.propertyId,
          entityType: 'property',
          entityId: input.propertyId,
          eventType: 'retention.applied',
          origin: 'platform',
          actor: systemActor,
          payload: { total, rules: notable },
        }),
      ),
    )
  }

  return { propertyId: input.propertyId, results, total }
}

/**
 * The declared periods, in a shape a human reads.
 *
 * Used by the runbook and by the console's own "what do we keep" panel, so the
 * answer an owner is given is generated from the same declaration the sweep
 * runs. Two prose descriptions of one policy is one prose description too many.
 */
export function declaredPeriods(): { table: string; period: string; why: string }[] {
  return DATA_MAP.map((entry) => {
    const { retention } = entry

    switch (retention.kind) {
      case 'purge-columns':
        return {
          table: entry.table,
          period: `${Object.keys(retention.columns).join(', ')} cleared after ${retention.afterDays} days`,
          why: retention.why,
        }
      case 'delete-rows':
        return {
          table: entry.table,
          period: `deleted after ${retention.afterDays} days`,
          why: retention.why,
        }
      case 'job':
        return { table: entry.table, period: `on ${retention.job}`, why: retention.why }
      case 'cascade':
        return { table: entry.table, period: `with ${retention.parent}`, why: retention.why }
      case 'keep':
        return { table: entry.table, period: 'kept', why: retention.why }
    }
  })
}
