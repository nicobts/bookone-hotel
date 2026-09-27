import type { listAdminAudit } from '@bookone/core/admin'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bookone/ui/components/table'

type Row = Awaited<ReturnType<typeof listAdminAudit>>[number]

function summary(value: unknown): string {
  if (value === null || value === undefined) return '—'
  return JSON.stringify(value)
}

export function AuditTable({ rows, showProperty }: { rows: Row[]; showProperty: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When (UTC)</TableHead>
          <TableHead>Who</TableHead>
          <TableHead>Action</TableHead>
          {showProperty ? <TableHead>Property</TableHead> : null}
          <TableHead>Reason</TableHead>
          <TableHead>Before → after</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono text-xs whitespace-nowrap">
              {row.at.toISOString().replace('T', ' ').slice(0, 19)}
            </TableCell>
            <TableCell className="text-xs">{row.actorEmail ?? row.actor}</TableCell>
            <TableCell className="font-mono text-xs">{row.action}</TableCell>
            {showProperty ? (
              <TableCell className="font-mono text-xs">{row.propertyId ?? '—'}</TableCell>
            ) : null}
            <TableCell className="text-sm">{row.reason}</TableCell>
            <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
              {summary(row.before)} → {summary(row.after)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
