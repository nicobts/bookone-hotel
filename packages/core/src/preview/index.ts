import { sql } from 'drizzle-orm'
import { asService, withUser } from '../db/session'
import { emit } from '../events'
import { userActor } from '../events/actor'

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
      select p.id, p.name, p.slug, p.locale_default,
             (select c.phone from property_contacts c
               where c.property_id = p.id and c.role = 'owner'
               order by c.created_at limit 1) as owner_phone
        from properties p
       where coalesce((p.settings->>'demo')::boolean, false)
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

// ------------------------------------------------------------ console preview (ADR-038)

/** Who tried the concierge from the console, as an event on the run. */
export async function recordPreview(input: {
  propertyId: string
  userId: string
  runId: string
}): Promise<void> {
  await asService((db) =>
    db.transaction(async (tx) => {
      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'agent_run',
        entityId: input.runId,
        eventType: 'agent.previewed',
        origin: 'platform',
        actor: userActor(input.userId),
      })
    }),
  )
}

export interface ConsoleRun {
  runId: string
  agent: string
  reply: string
  outcome: 'answered' | 'escalated' | 'failed' | 'not-understood'
  profile: string | null
  hardRule: string | null
  tier: string | null
  routeSource: string | null
  model: string | null
  tools: { tool: string; status: string }[]
}

/**
 * The run a console chat turn produced, read back as the signed-in member —
 * RLS on `agent_runs` decides visibility, as for everything else the console
 * reads. Null until the worker has recorded it.
 */
export async function readRunByRequest(
  userId: string,
  propertyId: string,
  requestId: string,
): Promise<ConsoleRun | null> {
  const [row] = await withUser(userId, (tx) =>
    tx.execute<{
      id: string
      agent: string
      output: Record<string, unknown> | null
      tool_calls: { tool?: string; status?: string }[] | null
    }>(sql`
      select id, agent, output, tool_calls from agent_runs
       where property_id = ${propertyId} and input_ref = ${requestId}
       order by at desc limit 1`),
  )
  if (!row) return null

  const out = row.output ?? {}
  const str = (key: string) => (typeof out[key] === 'string' ? (out[key] as string) : null)
  const reply = str('reply') ?? ''
  const outcome: ConsoleRun['outcome'] =
    typeof out.error === 'string'
      ? 'failed'
      : out.escalate === true
        ? 'escalated'
        : reply
          ? 'answered'
          : 'not-understood'

  return {
    runId: row.id,
    agent: row.agent,
    reply,
    outcome,
    profile: str('profile'),
    hardRule: str('hardRule'),
    tier: str('tier'),
    routeSource: str('routeSource'),
    model: str('model'),
    tools: (row.tool_calls ?? []).map((call) => ({
      tool: call.tool ?? '?',
      status: call.status ?? 'done',
    })),
  }
}

export interface AgentActivity {
  agent: string
  turns: number
  handedOver: number
  pending: number
  lastRunAt: Date | null
}

/**
 * The last seven days per agent, for the agents page. Previews are left out:
 * they are the team testing, not the agent working.
 */
export async function agentActivity(userId: string, propertyId: string): Promise<AgentActivity[]> {
  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      agent: string
      turns: number
      handed_over: number
      pending: number
      last_run_at: Date | null
    }>(sql`
      select agent,
             count(*)::int as turns,
             count(*) filter (where output->>'escalate' = 'true')::int as handed_over,
             count(*) filter (where outcome is null
                                and tool_calls @> '[{"status":"pending_approval"}]'::jsonb)::int as pending,
             max(at) as last_run_at
        from agent_runs
       where property_id = ${propertyId}
         and at > now() - interval '7 days'
         and coalesce(output->>'preview', 'false') <> 'true'
       group by agent`),
  )
  return [...rows].map((r) => ({
    agent: r.agent,
    turns: r.turns,
    handedOver: r.handed_over,
    pending: r.pending,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at) : null,
  }))
}

/** Whether an operator paused the concierge here (ADR-031's kill switch). */
export async function isConciergePaused(propertyId: string): Promise<boolean> {
  const [row] = await asService((db) =>
    db.execute<{ paused: boolean }>(
      sql`select (settings ? 'agentPausedAt') as paused from properties where id = ${propertyId}`,
    ),
  )
  return row?.paused ?? false
}

export interface ConsoleStay {
  reservationId: string
  label: string
}

/** Current stays a member may speak as in a preview: in house or arriving within a week. */
export async function listPreviewStays(userId: string, propertyId: string): Promise<ConsoleStay[]> {
  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      id: string
      reference: string | null
      name: string | null
      arrival_date: string
    }>(sql`
      select r.id, r.reference, g.name, r.arrival_date::text
        from reservations r
        left join guests g on g.id = r.guest_id
       where r.property_id = ${propertyId}
         and r.status = 'confirmed'
         and current_date between r.arrival_date - 7 and r.departure_date
       order by r.arrival_date
       limit 25`),
  )
  return [...rows].map((r) => ({
    reservationId: r.id,
    label: [r.name, r.reference, r.arrival_date].filter(Boolean).join(' · '),
  }))
}
