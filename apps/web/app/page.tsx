import { redirect } from 'next/navigation'
import { listTables } from '@retentionos/engine'
import { getCurrentOrg } from '@/lib/org'

// Home: jump to the first table if one exists, otherwise show an empty state prompting
// the user to create one (the sidebar's New-table button drives creation).
export default async function Home() {
  let firstSlug: string | null = null
  try {
    const org = await getCurrentOrg()
    const tables = await listTables(org.id)
    firstSlug = tables[0]?.slug ?? null
  } catch {
    firstSlug = null
  }

  if (firstSlug) redirect(`/t/${firstSlug}`)

  return (
    <div style={{ padding: 48, maxWidth: 520 }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Welcome to RetentionOS</h1>
      <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        This is the meta-schema engine — you (or an agent) build the tables. Click{' '}
        <strong>+ New table</strong> in the left sidebar to create your first table, add
        fields of any type, and start entering records in the grid.
      </p>
    </div>
  )
}
