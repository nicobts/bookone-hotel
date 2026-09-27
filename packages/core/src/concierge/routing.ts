import { and, desc, eq, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { agentRuns } from '../db/schema'

/**
 * What the orchestrator decided on this thread's recent turns (ADR-021).
 *
 * Read from the orchestrator's own runs: each one records the thread, the
 * profile it routed to and whether the intent was unknown. Two things follow
 * from these rows — the sticky profile, and the "unknown twice" hard rule —
 * and neither needs a column of its own. A thread's routing state is the
 * history of its routing, not a second copy that can disagree with it.
 *
 * Newest first. Scoped by property as well as thread: the runner already
 * scopes every run, and a thread id from one property must not read another's
 * history even if it were somehow guessed.
 */
export interface RoutingTurn {
  profile: string | null
  unknown: boolean
  hardRule: string | null
}

export async function recentRouting(
  propertyId: string,
  threadId: string,
  limit = 5,
): Promise<RoutingTurn[]> {
  const rows = await asService((db) =>
    db
      .select({ output: agentRuns.output })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.propertyId, propertyId),
          eq(agentRuns.agent, 'AG-01'),
          sql`${agentRuns.output} ->> 'threadId' = ${threadId}`,
        ),
      )
      .orderBy(desc(agentRuns.at))
      .limit(limit),
  )

  return rows.map(({ output }) => {
    const record = (output ?? {}) as Record<string, unknown>
    return {
      profile: typeof record.profile === 'string' ? record.profile : null,
      unknown: record.unknownIntent === true,
      hardRule: typeof record.hardRule === 'string' ? record.hardRule : null,
    }
  })
}
