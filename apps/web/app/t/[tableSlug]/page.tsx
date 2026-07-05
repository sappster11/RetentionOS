import { notFound } from 'next/navigation'
import { describeTable, getTableBySlug, queryRecords } from '@retentionos/engine'
import { getCurrentOrg } from '@/lib/org'
import { Grid } from '@/app/_ui/Grid'

// Server component: resolve slug -> table, load its fields + first page of records, and
// hand the initial data to the interactive Grid (which mutates via /api/v1).
export default async function TablePage({
  params,
}: {
  params: Promise<{ tableSlug: string }>
}) {
  const { tableSlug } = await params
  const org = await getCurrentOrg()
  const table = await getTableBySlug(org.id, tableSlug)
  if (!table) notFound()

  const [descriptor, page] = await Promise.all([
    describeTable(org.id, table.id),
    queryRecords(org.id, table.id, { limit: 200 }),
  ])

  return (
    <Grid
      table={descriptor.table}
      initialFields={descriptor.fields}
      initialRecords={page.records}
    />
  )
}
