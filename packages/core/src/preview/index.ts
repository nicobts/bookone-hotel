import { sql } from 'drizzle-orm'
import { asService } from '../db/session'

/**
 * Reads for the agent playground (ADR-037). Demo properties only: the
 * playground runs real turns, and on a real property that would put an
 * operator's words into a real guest's stay. `settings.demo` is set by
 * `pnpm demo:seed` and by nothing else.
 */
export class NotADemoProperty extends Error {
  constructor() {
    super('the agent playground runs only on demo properties')
    this.name = 'NotADemoProperty'
  }
}

export async function isDemoProperty(propertyId: string): Promise<boolean> {
  const [row] = await asService((db) =>
    db.execute<{ demo: boolean }>(
      sql`select coalesce((settings->>'demo')::boolean, false) as demo from properties where id = ${propertyId}`,
    ),
  )
  return row?.demo ?? false
}

export interface PreviewStay {
  reservationId: string
  reference: string | null
  guestName: string | null
  locale: string
  arrivalDate: string
  departureDate: string
  threadId: string | null
}

export interface PreviewProperty {
  id: string
  name: string
  slug: string
  localeDefault: string
  ownerPhone: string | null
  stays: PreviewStay[]
}

/**
 * Every demo property with the stays a tester can speak as: confirmed, from a
 * week before arrival to two days after departure — the stays a real guest
 * could be writing about.
 */
export async function listPreviewTargets(): Promise<PreviewProperty[]> {
  return asService(async (db) => {
    const props = await db.execute<{
      id: string
      name: string
      slug: string
      locale_default: string
      owner_phone: string | null
    }>(sql`
      select id, name, slug, locale_default, settings->'ownerPhones'->>0 as owner_phone
        from properties
       where coalesce((settings->>'demo')::boolean, false)
       order by name`)

    const result: PreviewProperty[] = []
    for (const p of props) {
      const stays = await db.execute<{
        reservation_id: string
        reference: string | null
        guest_name: string | null
        locale: string | null
        arrival_date: string
        departure_date: string
        thread_id: string | null
      }>(sql`
        select r.id as reservation_id, r.reference, g.name as guest_name, g.locale,
               r.arrival_date::text, r.departure_date::text, t.id as thread_id
          from reservations r
          left join guests g on g.id = r.guest_id and g.property_id = r.property_id
          left join message_threads t on t.reservation_id = r.id and t.property_id = r.property_id
         where r.property_id = ${p.id}
           and r.status = 'confirmed'
           and current_date between r.arrival_date - 7 and r.departure_date + 2
         order by r.arrival_date, g.name
         limit 40`)

      result.push({
        id: p.id,
        name: p.name,
        slug: p.slug,
        localeDefault: p.locale_default,
        ownerPhone: p.owner_phone,
        stays: [...stays].map((s) => ({
          reservationId: s.reservation_id,
          reference: s.reference,
          guestName: s.guest_name,
          locale: s.locale ?? p.locale_default,
          arrivalDate: s.arrival_date,
          departureDate: s.departure_date,
          threadId: s.thread_id,
        })),
      })
    }
    return result
  })
}

export interface PreviewRun {
  runId: string
  agent: string
  outcome: string | null
  tier: string | null
  model: string | null
  latencyMs: number | null
  profile: string | null
  hardRule: string | null
  action: string | null
  routeSource: string | null
  reason: string | null
  tools: { tool: string; status: string; reversible: boolean }[]
}

/** What one run decided, for the playground's run details. Ids and names only. */
export async function getPreviewRun(propertyId: string, runId: string): Promise<PreviewRun | null> {
  const [row] = await asService((db) =>
    db.execute<{
      id: string
      agent: string
      outcome: string | null
      tier_applied: string | null
      model: string | null
      latency_ms: number | null
      output: Record<string, unknown> | null
      tool_calls: { tool?: string; status?: string; reversible?: boolean }[] | null
    }>(sql`
      select id, agent, outcome::text, tier_applied::text, model, latency_ms, output, tool_calls
        from agent_runs where id = ${runId} and property_id = ${propertyId}`),
  )
  if (!row) return null

  const out = row.output ?? {}
  const str = (key: string) => (typeof out[key] === 'string' ? (out[key] as string) : null)
  return {
    runId: row.id,
    agent: row.agent,
    outcome: row.outcome,
    tier: str('tier') ?? row.tier_applied,
    model: str('model') ?? row.model,
    latencyMs: row.latency_ms,
    profile: str('profile'),
    hardRule: str('hardRule'),
    action: str('action'),
    routeSource: str('routeSource'),
    reason: str('reason'),
    tools: (row.tool_calls ?? []).map((call) => ({
      tool: call.tool ?? '?',
      status: call.status ?? 'done',
      reversible: call.reversible ?? false,
    })),
  }
}
