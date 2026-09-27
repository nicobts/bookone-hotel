import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { activeTenantView, listPropertiesForAdmin, tenantSnapshot } from '@bookone/core/admin'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireStaff } from '@/lib/staff'

export const metadata = { title: 'Read-only view' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function time(date: Date | null): string {
  return date ? date.toISOString().replace('T', ' ').slice(0, 16) : '—'
}

/**
 * View-as-tenant (ADR-031). Reachable only inside the 30-minute window that a
 * `tenant.view` audit row opened; otherwise back to the property page, where
 * opening one asks for a reason. Nothing on this page posts anywhere.
 */
export default async function TenantViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const staff = await requireStaff()
  const expiresAt = await activeTenantView(staff, id)
  if (!expiresAt) redirect(`/properties/${id}`)

  const property = (await listPropertiesForAdmin()).find((p) => p.id === id)
  if (!property) notFound()

  const snapshot = await tenantSnapshot(id)

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span>
          Read-only view of <strong>{property.name}</strong>, open until {time(expiresAt)} UTC. The
          property can see that you looked, and why.
        </span>
        <Link href={`/properties/${id}`} className="underline">
          Back to the property
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Stays, next 14 days</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Guest</TableHead>
              <TableHead>Arrival</TableHead>
              <TableHead>Departure</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.stays.map((stay, index) => (
              <TableRow key={`${stay.reference}-${index}`}>
                <TableCell className="font-mono text-xs">{stay.reference ?? '—'}</TableCell>
                <TableCell>{stay.guestName ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{stay.arrivalDate}</TableCell>
                <TableCell className="font-mono text-xs">{stay.departureDate}</TableCell>
                <TableCell>
                  <Badge variant="outline">{stay.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Conversations</h2>
        <p className="text-xs text-muted-foreground">
          State only. Message text and documents are not part of a support view.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Messages</TableHead>
              <TableHead>Last guest message (UTC)</TableHead>
              <TableHead>Escalation reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.threads.map((thread) => (
              <TableRow key={thread.id}>
                <TableCell>
                  <Badge variant={thread.status === 'escalated' ? 'destructive' : 'secondary'}>
                    {thread.status}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono">{thread.messages}</TableCell>
                <TableCell className="font-mono text-xs">
                  {time(thread.lastGuestMessageAt)}
                </TableCell>
                <TableCell className="text-xs">{thread.escalationReason ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Assistant runs</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When (UTC)</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Model</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.runs.map((run, index) => (
              <TableRow key={`${run.at.toISOString()}-${index}`}>
                <TableCell className="font-mono text-xs">{time(run.at)}</TableCell>
                <TableCell className="font-mono text-xs">{run.agent}</TableCell>
                <TableCell className="text-xs">{run.outcome ?? 'held'}</TableCell>
                <TableCell className="font-mono text-xs">{run.model ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
