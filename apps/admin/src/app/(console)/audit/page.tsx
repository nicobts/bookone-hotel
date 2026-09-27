import { listAdminAudit } from '@bookone/core/admin'
import { AuditTable } from '../audit-table'

export const metadata = { title: 'Audit trail' }

export default async function AuditPage() {
  const rows = await listAdminAudit(null, 200)

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Audit trail</h1>
        <p className="text-sm text-muted-foreground">
          Every operator change, newest first. Append-only: the database refuses edits and
          deletions.
        </p>
      </div>
      <AuditTable rows={rows} showProperty />
    </section>
  )
}
