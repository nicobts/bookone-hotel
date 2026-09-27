'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@bookone/ui/components/badge'

export interface RunData {
  agent: string
  outcome: 'answered' | 'escalated' | 'failed' | 'not-understood'
  profile: string | null
  hardRule: string | null
  tier: string | null
  routeSource: string | null
  model: string | null
  tools: { tool: string; status: string }[]
  preview: boolean
}

/**
 * What a turn decided, under its reply, in the owner's words: which part of
 * the assistant answered, whether a rule fired, and each action with what
 * happened to it. In a preview an action reads "would do, not done" — the
 * whole point of the preview is that nothing happened (ADR-038).
 */
export function RunDetails({ data }: { data: RunData }) {
  const t = useTranslations('console.agents')
  const has = (key: string) => t.has(key)

  const outcome = {
    answered: { label: t('outcomeAnswered'), variant: 'secondary' as const },
    escalated: { label: t('outcomeEscalated'), variant: 'destructive' as const },
    failed: { label: t('outcomeFailed'), variant: 'destructive' as const },
    'not-understood': { label: t('outcomeNotUnderstood'), variant: 'outline' as const },
  }[data.outcome]

  // The handover itself is shown by the outcome; listing it again as a tool is noise.
  const actions = data.tools.filter((call) => call.tool !== 'escalate')

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={outcome.variant}>{outcome.label}</Badge>
      {data.hardRule ? (
        <Badge variant="destructive">
          {t('ruleFired', {
            rule: has(`rules.${data.hardRule}.name`)
              ? t(`rules.${data.hardRule}.name`)
              : data.hardRule,
          })}
        </Badge>
      ) : null}
      {data.profile ? (
        <Badge variant="outline">
          {t('profileUsed', {
            profile: has(`profiles.${data.profile}.name`)
              ? t(`profiles.${data.profile}.name`)
              : data.profile,
          })}
        </Badge>
      ) : null}
      {actions.map((call, index) => (
        <Badge key={`${call.tool}-${index}`} variant="secondary" className="font-normal">
          {has(`tools.${call.tool}.label`) ? t(`tools.${call.tool}.label`) : call.tool}
          {call.status === 'simulated'
            ? ` · ${t('simulated')}`
            : call.status === 'pending_approval'
              ? ` · ${t('approvalWaits')}`
              : ''}
        </Badge>
      ))}
    </div>
  )
}
