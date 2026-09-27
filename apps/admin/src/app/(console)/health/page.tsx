import { queueHealth } from '@bookone/core/admin'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Queues</h1>
        <p className="text-sm text-muted-foreground">
          From pg-boss&apos;s own tables. A job that should run every few minutes and last finished
          hours ago is the first thing to look at.
        </p>
      </div>
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
  )
}
