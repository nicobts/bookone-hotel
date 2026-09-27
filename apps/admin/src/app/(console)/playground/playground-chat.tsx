'use client'

import type { UIMessage } from 'ai'
import { Chat } from '@bookone/ui/components/chat/chat'
import { Badge } from '@bookone/ui/components/badge'

interface RunData {
  outcome: string
  run: {
    runId: string
    agent: string
    profile: string | null
    hardRule: string | null
    tier: string | null
    action: string | null
    routeSource: string | null
    model: string | null
    reason: string | null
    latencyMs: number | null
    tools: { tool: string; status: string; reversible: boolean }[]
  } | null
}

const OUTCOME_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  answered: 'secondary',
  escalated: 'destructive',
  failed: 'destructive',
  silenced: 'outline',
  paused: 'outline',
  'not-understood': 'outline',
  refused: 'destructive',
}

/**
 * What the run decided, under each reply: the thing a tester is actually
 * looking for — which profile answered, whether a hard rule fired, which tools
 * ran and whether one is waiting for a person's approval.
 */
function RunDetails({ data }: { data: RunData }) {
  const run = data.run
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={OUTCOME_VARIANT[data.outcome] ?? 'outline'}>{data.outcome}</Badge>
      {run?.hardRule ? <Badge variant="destructive">rule: {run.hardRule}</Badge> : null}
      {run?.profile ? <Badge variant="outline">profile: {run.profile}</Badge> : null}
      {run?.tier ? <Badge variant="outline">{run.tier}</Badge> : null}
      {run?.tools.map((call, index) => (
        <Badge
          key={`${call.tool}-${index}`}
          variant={call.status === 'pending_approval' ? 'default' : 'secondary'}
        >
          {call.tool}
          {call.status === 'done' ? '' : ` · ${call.status.replace('_', ' ')}`}
        </Badge>
      ))}
      {run?.routeSource ? (
        <span className="text-muted-foreground">
          routed by {run.routeSource}
          {run.model ? ` (${run.model})` : ''}
        </span>
      ) : null}
      {run?.reason ? <span className="text-muted-foreground">· {run.reason}</span> : null}
      {run ? (
        <span className="text-muted-foreground font-mono">
          · {run.agent} · {run.runId.slice(0, 8)}
          {run.latencyMs !== null ? ` · ${run.latencyMs} ms` : ''}
        </span>
      ) : null}
    </div>
  )
}

export function PlaygroundChat({
  body,
  initialMessages,
  suggestions,
  assistantLabel,
  placeholder,
}: {
  body: Record<string, unknown>
  initialMessages: UIMessage[]
  suggestions: string[]
  assistantLabel: string
  placeholder: string
}) {
  return (
    <Chat
      api="/api/playground/chat"
      body={body}
      initialMessages={initialMessages}
      suggestions={suggestions}
      assistantLabel={assistantLabel}
      placeholder={placeholder}
      emptyTitle="Say something to the agent"
      emptyDescription="Every turn is real: the orchestrator, the profiles, the tools and the audit record, on the demo property."
      renderData={(part) =>
        part.type === 'data-run' ? <RunDetails data={part.data as RunData} /> : null
      }
    />
  )
}
