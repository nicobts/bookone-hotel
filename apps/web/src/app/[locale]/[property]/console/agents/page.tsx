import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { EyeIcon, ShieldCheckIcon, ZapIcon } from 'lucide-react'
import {
  AGENT_CATALOG,
  HARD_RULES,
  type CatalogAgent,
  type CatalogTool,
} from '@bookone/agents/catalog'
import { agentActivity, isConciergePaused, listPreviewStays } from '@bookone/core/preview'
import { Badge } from '@bookone/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@bookone/ui/components/card'
import { PageShell } from '@/components/shell/page-shell'
import { AgentPreviewSheet } from '@/components/agents/agent-preview-sheet'
import { propertyFeatures, requireFeature } from '@/lib/auth/current-property'

/**
 * The agents page (ADR-038, design note `docs/design-notes/agents.md`).
 *
 * What each agent does for this property and how it behaves, generated from
 * the agents' own definitions (`@bookone/agents/catalog`) — never from copy —
 * and a side panel to try the conversational ones. Owners and staff alike:
 * understanding the concierge is part of running the house.
 */
export default async function AgentsPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { user, property } = await requireFeature(locale, slug, 'concierge')
  const isOwner = property.role === 'owner'

  const [t, tAssistant, format, features, activity, paused, stays] = await Promise.all([
    getTranslations('console.agents'),
    getTranslations('console.assistant'),
    getFormatter(),
    propertyFeatures(property.id),
    agentActivity(user.id, property.id),
    isConciergePaused(property.id),
    listPreviewStays(user.id, property.id),
  ])

  const statusOf = (agent: CatalogAgent) => {
    if (agent.feature !== 'core' && !features.has(agent.feature)) {
      return { label: t('off'), variant: 'outline' as const }
    }
    if (agent.id === 'AG-01' && paused) {
      return { label: t('paused'), variant: 'destructive' as const }
    }
    return { label: t('active'), variant: 'secondary' as const }
  }

  return (
    <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
      <p className="text-muted-foreground max-w-3xl text-sm">{t('legend')}</p>

      <div className="flex flex-col gap-4">
        {AGENT_CATALOG.map((agent) => {
          const status = statusOf(agent)
          const available = status.label !== t('off')
          const stats = activity.find((a) => a.agent === agent.id)
          const canChat =
            available &&
            ((agent.id === 'AG-01' && agent.kind === 'conversation') ||
              (agent.id === 'AG-06' && isOwner))

          return (
            <Card key={agent.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {t(`agents.${agent.id}.name`)}
                    <Badge variant={status.variant}>{status.label}</Badge>
                    {agent.kind === 'background' ? (
                      <Badge variant="outline">{t('background')}</Badge>
                    ) : null}
                  </CardTitle>
                  <p className="text-muted-foreground text-sm">{t(`agents.${agent.id}.purpose`)}</p>
                  <p className="text-muted-foreground text-xs">
                    {t('whoFor')}: {t(`agents.${agent.id}.audience`)}
                    {' · '}
                    {t('activity')}:{' '}
                    {stats
                      ? [
                          t('turns', { count: stats.turns }),
                          agent.kind === 'conversation'
                            ? t('handedOver', { count: stats.handedOver })
                            : null,
                          stats.pending > 0 ? t('pending', { count: stats.pending }) : null,
                          stats.lastRunAt
                            ? t('lastRun', { when: format.relativeTime(stats.lastRunAt) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : t('never')}
                  </p>
                </div>

                {canChat ? (
                  <AgentPreviewSheet
                    agent={agent.id as 'AG-01' | 'AG-06'}
                    slug={slug}
                    locale={locale}
                    label={agent.id === 'AG-01' ? t('try') : t('tryOwner')}
                    title={agent.id === 'AG-01' ? t('previewTitle') : tAssistant('title')}
                    description={
                      agent.id === 'AG-01'
                        ? t('previewDescription')
                        : tAssistant('emptyDescription')
                    }
                    stays={stays}
                    labels={{
                      speakAs: t('previewAs'),
                      noStay: t('previewNoStay'),
                      placeholder:
                        agent.id === 'AG-01' ? t('previewPlaceholder') : tAssistant('placeholder'),
                      emptyTitle:
                        agent.id === 'AG-01' ? t('previewEmptyTitle') : tAssistant('emptyTitle'),
                      emptyDescription:
                        agent.id === 'AG-01'
                          ? t('previewEmptyDescription')
                          : tAssistant('emptyDescription'),
                    }}
                    suggestions={
                      (agent.id === 'AG-01'
                        ? t.raw('previewSuggestions')
                        : tAssistant.raw('suggestions')) as string[]
                    }
                  />
                ) : agent.id === 'AG-06' && !isOwner ? (
                  <span className="text-muted-foreground text-xs">{t('ownerOnly')}</span>
                ) : null}
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                {agent.profiles.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">{t('sectionProfiles')}</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {agent.profiles.map((profile) => (
                        <div key={profile.id} className="rounded-md border p-3">
                          <p className="text-sm font-medium">{t(`profiles.${profile.id}.name`)}</p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {t(`profiles.${profile.id}.description`)}
                          </p>
                          <ToolList tools={profile.tools} t={t} />
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {agent.tools.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">{t('sectionTools')}</h3>
                    <ToolList tools={agent.tools} t={t} />
                  </section>
                ) : null}

                {agent.id === 'AG-01' ? (
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">{t('sectionRules')}</h3>
                    <p className="text-muted-foreground text-xs">{t('rulesIntro')}</p>
                    <ul className="grid gap-2 md:grid-cols-2">
                      {HARD_RULES.map((rule) => (
                        <li key={rule} className="rounded-md border p-3">
                          <p className="text-sm font-medium">{t(`rules.${rule}.name`)}</p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {t(`rules.${rule}.description`)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </PageShell>
  )
}

const CLASS_ICON = { read: EyeIcon, action: ZapIcon, approval: ShieldCheckIcon } as const
const CLASS_KEY = { read: 'classRead', action: 'classAction', approval: 'classApproval' } as const

function ToolList({
  tools,
  t,
}: {
  tools: CatalogTool[]
  t: Awaited<ReturnType<typeof getTranslations<'console.agents'>>>
}) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {tools.map((tool) => {
        const Icon = CLASS_ICON[tool.class]
        return (
          <li key={tool.name}>
            <Badge
              variant={tool.class === 'approval' ? 'default' : 'secondary'}
              className="gap-1 font-normal"
              title={t(CLASS_KEY[tool.class])}
            >
              <Icon className="size-3" aria-label={t(CLASS_KEY[tool.class])} />
              {t(`tools.${tool.name}.label`)}
            </Badge>
          </li>
        )
      })}
    </ul>
  )
}
