import { notFound } from 'next/navigation'
import { listAdminAudit, listPropertiesForAdmin } from '@bookone/core/admin'
import { FEATURES } from '@bookone/core/onboarding'
import { Badge } from '@bookone/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@bookone/ui/components/card'
import { requireStaff } from '@/lib/staff'
import { AuditTable } from '../../audit-table'
import { ReasonForm } from '../../reason-form'
import { setAgentPaused, setFeature, viewAsTenant } from '../../actions'
import { PageShell } from '@/components/shell/page-shell'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const staff = await requireStaff()
  const property = (await listPropertiesForAdmin()).find((p) => p.id === id)
  if (!property) notFound()

  const trail = await listAdminAudit(property.id, 50)
  const canChange = staff.role === 'admin'

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

        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Operator trail</h2>
          <AuditTable rows={trail} showProperty={false} />
        </div>
      </section>
    </PageShell>
  )
}
