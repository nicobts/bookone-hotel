import Link from 'next/link'
import { listPropertiesForAdmin } from '@bookone/core/admin'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = { title: 'Properties' }

export default async function PropertiesPage() {
  const properties = await listPropertiesForAdmin()

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Properties</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Features</TableHead>
            <TableHead>Concierge</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {properties.map((property) => (
            <TableRow key={property.id}>
              <TableCell>
                <Link href={`/properties/${property.id}`} className="font-medium hover:underline">
                  {property.name}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-xs">{property.slug}</TableCell>
              <TableCell className="font-mono">{property.members}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {property.features.join(', ') || '—'}
              </TableCell>
              <TableCell>
                {property.agentPaused ? (
                  <Badge variant="destructive">paused</Badge>
                ) : (
                  <Badge variant="secondary">running</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
