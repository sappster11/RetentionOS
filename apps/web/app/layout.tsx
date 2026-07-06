import type { ReactNode } from 'react'
import { listBases, listTables } from '@retentionos/engine'
import { getCurrentOrg } from '@/lib/org'
import './theme.css'
import { AppShell } from './_ui/AppShell'

export const metadata = {
  title: 'RetentionOS',
  description: 'An owned, AI-native operating system — the meta-schema engine.',
}

// Server component: reads the base + table lists (reads; mutations go through /api/v1)
// and the current org, then hands them to the client-side shell which owns interactivity.
export default async function RootLayout({ children }: { children: ReactNode }) {
  let tables: Awaited<ReturnType<typeof listTables>> = []
  let bases: Awaited<ReturnType<typeof listBases>> = []
  let orgName = 'RetentionOS'
  try {
    const org = await getCurrentOrg()
    orgName = org.name
    ;[bases, tables] = await Promise.all([listBases(org.id), listTables(org.id)])
  } catch {
    // Unseeded / no DB — render an empty shell rather than crashing the whole app.
  }

  return (
    <html lang="en">
      <body>
        <AppShell bases={bases} tables={tables} orgName={orgName}>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
