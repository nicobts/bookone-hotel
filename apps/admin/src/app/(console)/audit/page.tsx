import { listAdminAudit } from '@bookone/core/admin'
import { AuditTable } from '../audit-table'
import { PageShell } from '@/components/shell/page-shell'

export const metadata = { title: 'Audit trail' }

export default async function AuditPage() {
  const rows = await listAdminAudit(null, 200)

  return (
    <PageShell
      title="Audit trail"
      subtitle="Every operator change, newest first. The database refuses edits and deletions."
    >
      <section className="flex flex-col gap-4">
        <AuditTable rows={rows} showProperty />
      </section>
    </PageShell>
  )
}
