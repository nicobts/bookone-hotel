import { notFound } from 'next/navigation'
import { listAdminAudit, listPropertiesForAdmin } from '@bookone/core/admin'
import { FEATURES } from '@bookone/core/onboarding'
import {
  assessTargets,
  firstActivityWeek,
  lastWeekStart,
  weekStartOf,
  weeklyPilotReport,
  weeklyReportText,
} from '@bookone/core/pilot'
import { Badge } from '@bookone/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@bookone/ui/components/card'
import { requireStaff } from '@/lib/staff'
import { AuditTable } from '../../audit-table'
import { ReasonForm } from '../../reason-form'
import { setAgentPaused, setFeature, viewAsTenant } from '../../actions'
import { PageShell } from '@/components/shell/page-shell'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day: `Date` would roll 2026-02-30 into March rather than refuse it. */
function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const { week } = await searchParams

  const staff = await requireStaff()
  const property = (await listPropertiesForAdmin()).find((p) => p.id === id)
  if (!property) notFound()

  const trail = await listAdminAudit(property.id, 50)
  const canChange = staff.role === 'admin'

  // The pilot's week (WP1.7): last week by default, or `?week=` any day of another.
  const weekStart =
    week && isCalendarDate(week) ? weekStartOf(week) : lastWeekStart(new Date(), property.timezone)
  const report = await weeklyPilotReport(property.id, { weekStart, timeZone: property.timezone })
  const firstWeek = await firstActivityWeek(property.id, property.timezone)
  const baseline =
    firstWeek && firstWeek !== weekStart
      ? await weeklyPilotReport(property.id, { weekStart: firstWeek, timeZone: property.timezone })
      : null
  const targets = assessTargets(report, baseline)

  return (
    <PageShell title={property.name} subtitle={`${property.slug} · ${property.id}`}>
      <section className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">View as tenant</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Read-only, for 30 minutes. The reason is recorded here and shown to the property in
              its own settings.
            </p>
            <ReasonForm
              action={viewAsTenant}
              hidden={{ propertyId: property.id }}
              label="Open a read-only view"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-base">
              Concierge
              {property.agentPaused ? (
                <Badge variant="destructive">paused</Badge>
              ) : (
                <Badge variant="secondary">running</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Paused, every guest message is acknowledged and handed to the property&apos;s staff;
              no model is called and no tool runs. Takes effect on the next message.
            </p>
            {canChange ? (
              <ReasonForm
                action={setAgentPaused}
                hidden={{ propertyId: property.id, paused: String(!property.agentPaused) }}
                label={property.agentPaused ? 'Resume the concierge' : 'Pause the concierge'}
                destructive={!property.agentPaused}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Features</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {FEATURES.map((feature) => {
              const on = property.features.includes(feature)
              return (
                <div
                  key={feature}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono">{feature}</span>
                    {on ? <Badge>on</Badge> : <Badge variant="outline">off</Badge>}
                  </div>
                  {canChange ? (
                    <ReasonForm
                      action={setFeature}
                      hidden={{ propertyId: property.id, feature, enabled: String(!on) }}
                      label={on ? 'Revoke' : 'Grant'}
                      destructive={on}
                      compact
                    />
                  ) : null}
                </div>
              )
            })}
          </CardContent>
        </Card>

        <PilotWeek
          propertyId={property.id}
          report={report}
          targets={targets}
          firstWeek={firstWeek}
          text={weeklyReportText(report)}
        />

        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Operator trail</h2>
          <AuditTable rows={trail} showProperty={false} />
        </div>
      </section>
    </PageShell>
  )
}

const TARGET_LABELS: Record<keyof ReturnType<typeof assessTargets>, string> = {
  missedFilings: 'No missed filing deadline',
  autoResolutionRate: 'At least 70% resolved without a person',
  medianFirstResponseSeconds: 'Median first response within 30 s',
  unsafeActions: 'No unsafe action',
  interruptionsVsFirstWeek: 'Interruptions halved against the first week',
}

/** The Monday before a Monday, `YYYY-MM-DD`. */
function weekBefore(weekStart: string): string {
  return new Date(Date.parse(`${weekStart}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10)
}

/**
 * One pilot's week (Guest Desk WP1.7): the plan's exit metrics, each target
 * met or missed, and the text the operator sends the owner. Counts only; no
 * guest appears here. Escalation precision and CSAT are not measured by the
 * product, and the card says so.
 */
function PilotWeek({
  propertyId,
  report,
  targets,
  firstWeek,
  text,
}: {
  propertyId: string
  report: Awaited<ReturnType<typeof weeklyPilotReport>>
  targets: ReturnType<typeof assessTargets>
  firstWeek: string | null
  text: string
}) {
  const { desk } = report
  const euros = (cents: number) => `€${(cents / 100).toFixed(2)}`
  const figures: [string, string][] = [
    ['Conversations', String(desk.threads)],
    ['Guest turns (unanswered)', `${desk.turns} (${desk.unansweredTurns})`],
    [
      'Median first response',
      desk.medianFirstResponseSeconds === null
        ? 'n/a'
        : `${Math.round(desk.medianFirstResponseSeconds)} s`,
    ],
    [
      'Resolved without a person',
      desk.autoResolutionRate === null ? 'n/a' : `${Math.round(desk.autoResolutionRate * 100)}%`,
    ],
    ['Escalations, phone alerts', `${desk.escalations}, ${desk.phoneAlerts}`],
    [
      'Model cost (per conversation)',
      desk.costPerThreadCents === null
        ? euros(desk.costCents)
        : `${euros(desk.costCents)} (${euros(desk.costPerThreadCents)})`,
    ],
    ['Replies audited, unsafe', `${desk.repliesChecked}, ${desk.unsafeActions}`],
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
          <span>
            Pilot week, {report.weekStart} to {report.weekEnd}
          </span>
          <a
            className="text-sm font-normal text-muted-foreground underline"
            href={`/properties/${propertyId}?week=${weekBefore(report.weekStart)}`}
          >
            Previous week
          </a>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <ul className="flex flex-col gap-1">
          {Object.entries(TARGET_LABELS).map(([key, label]) => {
            const state = targets[key as keyof typeof targets]
            return (
              <li key={key} className="flex items-center justify-between gap-3">
                <span>{label}</span>
                <Badge
                  variant={
                    state === 'missed' ? 'destructive' : state === 'met' ? 'secondary' : 'outline'
                  }
                >
                  {state}
                </Badge>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Not measured by the product: escalation precision (a person has to label each escalation)
          and guest satisfaction (no survey is sent). First week: {firstWeek ?? 'none yet'}.
        </p>

        <dl className="grid max-w-md gap-1">
          {figures.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-1">
          <p className="font-medium">Filings</p>
          {report.filings.length === 0 ? (
            <p className="text-muted-foreground">No deadlines in the week.</p>
          ) : (
            report.filings.map((f) => (
              <p key={f.authority} className="font-mono text-xs">
                {f.authority}: {f.due} due, {f.onTime} on time, {f.late} late,{' '}
                <span className={f.missed > 0 ? 'text-destructive' : ''}>{f.missed} missed</span>,{' '}
                {f.byHand} by hand, {f.notYetDue} not yet due
              </p>
            ))
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="weekly-text" className="font-medium">
            The report for the owner
          </label>
          <p className="text-xs text-muted-foreground">
            Counts only. The operator sends it by hand until an email provider is chosen.
          </p>
          <textarea
            id="weekly-text"
            readOnly
            rows={16}
            defaultValue={text}
            className="w-full rounded-md border bg-transparent p-2 font-mono text-xs"
          />
        </div>
      </CardContent>
    </Card>
  )
}
