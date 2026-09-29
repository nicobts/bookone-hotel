import { listPropertiesForAdmin, queueHealth } from '@bookone/core/admin'
import { filingSlaByProperty } from '@bookone/core/pilot'
import { Badge } from '@bookone/ui/components/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bookone/ui/components/table'
import { PageShell } from '@/components/shell/page-shell'

export const metadata = { title: 'Health' }

function ago(date: Date | null): string {
  if (!date) return 'never'
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

export default async function HealthPage() {
  const queues = await queueHealth()
  // WP1.7: the filings SLA across properties, last seven days. Counts only.
  const sla = await filingSlaByProperty({ days: 7 })
  const slugs = new Map((await listPropertiesForAdmin()).map((p) => [p.id, p.slug]))

  return (
    <PageShell title="Health" subtitle="Queues, from pg-boss’s own tables, and the filings SLA">
      <section className="flex flex-col gap-4">
        {queues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No queues yet — the worker has not started against this database.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Failed (24 h)</TableHead>
                <TableHead>Last completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queues.map((queue) => (
                <TableRow key={queue.name}>
                  <TableCell className="font-mono text-xs">{queue.name}</TableCell>
                  <TableCell className="font-mono">{queue.queued}</TableCell>
                  <TableCell className="font-mono">{queue.active}</TableCell>
                  <TableCell>
                    {queue.failedLastDay > 0 ? (
                      <Badge variant="destructive">{queue.failedLastDay}</Badge>
                    ) : (
                      <span className="font-mono">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{ago(queue.lastCompletedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Filings, last 7 days</h2>
          <p className="text-sm text-muted-foreground">
            Deadlines that passed in the last seven days, per property and authority. A missed
            filing is one still not with the authority after its deadline.
          </p>
        </div>
        {sla.length === 0 ? (
          <p className="text-sm text-muted-foreground">No filing deadline passed this week.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Authority</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>On time</TableHead>
                <TableHead>Late</TableHead>
                <TableHead>Missed</TableHead>
                <TableHead>By hand</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sla.map((row) => (
                <TableRow key={`${row.propertyId}:${row.authority}`}>
                  <TableCell>
                    <a className="underline" href={`/properties/${row.propertyId}`}>
                      {slugs.get(row.propertyId) ?? row.propertyId}
                    </a>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.authority}</TableCell>
                  <TableCell className="font-mono">{row.due}</TableCell>
                  <TableCell className="font-mono">{row.onTime}</TableCell>
                  <TableCell className="font-mono">{row.late}</TableCell>
                  <TableCell>
                    {row.missed > 0 ? (
                      <Badge variant="destructive">{row.missed}</Badge>
                    ) : (
                      <span className="font-mono">0</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">{row.byHand}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </PageShell>
  )
}
