import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '../../db/schema'
import { DATA_MAP, DATA_MAP_BY_TABLE, executableRules } from '../data-map'

/**
 * The test that makes the data map a control rather than a document.
 *
 * A data map is true on the day it is written. What keeps it true is this file:
 * the next person who adds a table gets a failure that names their table and
 * tells them where to declare it, on the same run as their own tests, before
 * the schema change is even reviewable.
 *
 * The alternative — an annual review — finds the gap eighteen months after the
 * table started collecting email addresses.
 */

/** Every `pgTable` exported by the schema, by its SQL name. */
function schemaTables(): Map<string, PgTable> {
  const tables = new Map<string, PgTable>()

  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) tables.set(getTableName(value), value)
  }

  return tables
}

function columnNames(table: PgTable): Set<string> {
  return new Set(Object.values(getTableColumns(table)).map((column) => column.name))
}

describe('coverage', () => {
  it('declares every table in the schema', () => {
    const undeclared = [...schemaTables().keys()].filter((name) => !DATA_MAP_BY_TABLE.has(name))

    /*
     * If this fails, the fix is an entry in `data-map.ts` — not an exclusion
     * here. A table with no personal data still gets one, saying so: "we
     * checked and there is nothing" and "we forgot this table" are
     * indistinguishable from the outside, and only one of them is defensible.
     */
    expect(undeclared).toEqual([])
  })

  it('declares no table that does not exist', () => {
    const tables = schemaTables()
    const phantom = DATA_MAP.map((entry) => entry.table).filter((name) => !tables.has(name))

    // A dropped table leaving its entry behind makes the map claim we hold
    // something we do not, which is the same class of wrong in the other
    // direction.
    expect(phantom).toEqual([])
  })

  it('declares each table once', () => {
    const seen = new Set<string>()
    const duplicated = DATA_MAP.map((entry) => entry.table).filter((name) => {
      if (seen.has(name)) return true
      seen.add(name)
      return false
    })

    expect(duplicated).toEqual([])
  })
})

describe('the rules name real columns', () => {
  const tables = schemaTables()

  it.each(DATA_MAP.map((entry) => [entry.table, entry] as const))('%s', (name, entry) => {
    const table = tables.get(name)
    expect(table, `${name} is not in the schema`).toBeDefined()

    const columns = columnNames(table!)

    /*
     * The whole point of the executable rules is that the sweep runs them as
     * SQL. A column name that does not exist is a rule that throws at 04:00
     * on a Sunday, in a job nobody is watching, having deleted nothing.
     */
    if (entry.retention.kind === 'purge-columns') {
      // `departure` is resolved through the reservation, not a column here.
      if (entry.retention.anchor !== 'departure') {
        expect(columns, `${name}.${entry.retention.anchor}`).toContain(entry.retention.anchor)
      }

      for (const column of Object.keys(entry.retention.columns)) {
        expect(columns, `${name}.${column}`).toContain(column)
      }

      if (entry.retention.stamp) {
        expect(columns, `${name}.${entry.retention.stamp}`).toContain(entry.retention.stamp)
      }
    }

    if (entry.retention.kind === 'delete-rows') {
      expect(columns, `${name}.${entry.retention.anchor}`).toContain(entry.retention.anchor)
    }

    if (entry.erasure.kind === 'anonymise' || entry.erasure.kind === 'redact') {
      for (const column of Object.keys(entry.erasure.columns)) {
        expect(columns, `${name}.${column}`).toContain(column)
      }
    }
  })
})

describe('the declaration is coherent', () => {
  it('only claims a cascade the database actually performs', () => {
    /*
     * The one that would have shipped broken.
     *
     * Four of a reservation's children do not go when it does: `payments`,
     * `fee_events` and `alloggiati_submissions` are `restrict` deliberately —
     * money and a filing with a public authority should not vanish because
     * somebody deleted a stay — and `external_refs` points at it by id with no
     * foreign key at all. The ten-year rule would have thrown on its first
     * non-empty run, in a job nobody watches, having deleted nothing.
     *
     * So this asserts the map against the schema's own foreign keys rather than
     * against what the map says about itself.
     */
    const tables = schemaTables()

    /** Tables this parent's own rule deletes by hand, before its own rows. */
    const swept = new Map<string, Set<string>>()
    for (const entry of DATA_MAP) {
      if (entry.retention.kind !== 'delete-rows') continue
      swept.set(
        entry.table,
        new Set((entry.retention.dependents ?? []).map((dependent) => dependent.table)),
      )
    }

    const lying: string[] = []

    for (const entry of DATA_MAP) {
      if (entry.retention.kind !== 'cascade') continue

      const parent = entry.retention.parent
      // `auth.users` is Supabase's, outside this schema and outside the sweep.
      if (!tables.has(parent)) continue

      const cascades = getTableConfig(tables.get(entry.table)!).foreignKeys.some((key) => {
        const reference = key.reference()
        return (
          getTableName(reference.foreignTable) === parent &&
          key.onDelete?.toLowerCase() === 'cascade'
        )
      })

      if (cascades) continue
      if (swept.get(parent)?.has(entry.table)) continue

      lying.push(`${entry.table} -> ${parent}`)
    }

    expect(lying).toEqual([])
  })

  it('names a real column on every dependent it deletes by hand', () => {
    const tables = schemaTables()

    for (const entry of DATA_MAP) {
      if (entry.retention.kind !== 'delete-rows') continue

      for (const dependent of entry.retention.dependents ?? []) {
        const table = tables.get(dependent.table)
        expect(table, dependent.table).toBeDefined()
        expect(columnNames(table!), `${dependent.table}.${dependent.via}`).toContain(dependent.via)
      }
    }
  })

  it('gives every guest-bearing table a way into the export bundle', () => {
    /*
     * A table holding a guest's data and reachable by nothing is a table that
     * silently drops out of a subject access request. Two are deliberate and
     * both are named here rather than allowed by omission.
     */
    const unreachable = DATA_MAP.filter(
      (entry) => entry.subject === 'guest' && entry.exportVia === 'none',
    ).map((entry) => entry.table)

    expect(unreachable.sort()).toEqual(['agent_runs', 'discrepancies', 'domain_events'])
  })

  it('states a reason for every carve-out', () => {
    for (const entry of DATA_MAP) {
      if (entry.erasure.kind === 'keep') {
        // "We keep this" with no reason is the sentence a supervisory authority
        // asks the follow-up question about.
        expect(entry.erasure.why.length, entry.table).toBeGreaterThan(20)
      }

      if (entry.retention.kind === 'keep') {
        expect(entry.retention.why.length, entry.table).toBeGreaterThan(20)
      }
    }
  })

  it('holds no guest data with no basis stated', () => {
    for (const entry of DATA_MAP) {
      if (entry.subject === 'none') continue

      expect(entry.basis, entry.table).toMatch(/Art\. 6\(1\)\([abcf]\)/)
      expect(entry.categories.length, entry.table).toBeGreaterThan(0)
    }
  })

  it('has an executable rule for the periods PRD D6 declares', () => {
    const executable = new Map(executableRules().map((entry) => [entry.table, entry.retention]))

    // The three periods D6 names. If one of these stops being enforced by a
    // rule the sweep runs, the PRD is making a promise the code does not keep.
    expect(executable.get('messages')).toMatchObject({ kind: 'delete-rows', afterDays: 730 })
    expect(executable.get('reservations')).toMatchObject({ kind: 'delete-rows', afterDays: 3653 })
    expect(executable.get('registration_records')).toMatchObject({ kind: 'purge-columns' })
  })
})
