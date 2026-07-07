import { notFound } from 'next/navigation'
import { describeTable, getTableBySlug, queryRecords } from '@retentionos/engine'
import { getCurrentOrg } from '@/lib/org'
import { TableWorkspace } from '@/app/_ui/TableWorkspace'

// Server component: resolve slug -> table, load its fields, views, and first page of
// records, then hand the initial data to the interactive TableWorkspace (toolbar + views
// panel + grid). All mutations go back through /api/v1.
export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ tableSlug: string }>
  searchParams: Promise<{ record?: string }>
}) {
  const { tableSlug } = await params
  const { record: recordParam } = await searchParams
  const org = await getCurrentOrg()
  const table = await getTableBySlug(org.id, tableSlug)
  if (!table) notFound()

  const [descriptor, page] = await Promise.all([
    describeTable(org.id, table.id),
    queryRecords(org.id, table.id, { limit: 200 }),
  ])

  return (
    <TableWorkspace
      table={descriptor.table}
      initialFields={descriptor.fields}
      initialViews={descriptor.views}
      initialRecords={page.records}
      initialTotal={page.total}
      initialDetailRecordId={recordParam ?? null}
    />
  )
}
