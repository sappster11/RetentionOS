'use client'

// The outer app chrome: a slim top header (app mark + workspace name, chat toggle), the
// table-TABS strip (Airtable-style — replaces the old left sidebar as the table switcher),
// then the active table's page as children, then the collapsible chat panel. All chrome is
// light: white/near-white with 1px neutral borders.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { EngineTable } from '@retentionos/engine'
import { api } from './apiClient'
import { ChatPanel } from './ChatPanel'
import { CreateTableModal } from './CreateTableModal'
import { PlusIcon } from './icons'

export function AppShell({
  tables,
  orgName,
  children,
}: {
  tables: EngineTable[]
  orgName: string
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [modalOpen, setModalOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  // /login and /auth pages render bare (no shell chrome).
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    return <>{children}</>
  }

  const activeSlug = pathname.startsWith('/t/') ? pathname.split('/')[2] : null

  async function handleCreate(input: { name: string; icon?: string; description?: string }) {
    const table = await api.createTable(input)
    setModalOpen(false)
    router.push(`/t/${table.slug}`)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Main column: header + tabs + content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top header */}
        <header
          style={{
            height: 'var(--header-h)',
            flexShrink: 0,
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 14 }}>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: 'linear-gradient(135deg, var(--accent), #4a90d9)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
              }}
            >
              ◆
            </span>
            <span>{orgName}</span>
          </div>
          <button
            onClick={() => setChatOpen((v) => !v)}
            style={{
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg)',
              color: 'var(--text-muted)',
              padding: '4px 10px',
            }}
          >
            {chatOpen ? 'Hide chat' : 'Chat'}
          </button>
        </header>

        {/* Table tabs strip */}
        <div
          style={{
            height: 'var(--tabs-h)',
            flexShrink: 0,
            background: 'var(--bg-tabs)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-end',
            paddingLeft: 8,
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
        >
          {tables.length === 0 ? (
            <span style={{ color: 'var(--text-faint)', fontSize: 12, padding: '0 10px 10px' }}>
              No tables yet — click + to create one.
            </span>
          ) : (
            tables.map((t) => {
              const active = activeSlug === t.slug
              return (
                <Link
                  key={t.id}
                  href={`/t/${t.slug}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 'calc(var(--tabs-h) - 1px)',
                    padding: '0 14px',
                    marginBottom: -1,
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                    background: active ? 'var(--bg)' : 'transparent',
                    border: active ? '1px solid var(--border)' : '1px solid transparent',
                    borderBottom: active ? '1px solid var(--bg)' : '1px solid transparent',
                    borderTopLeftRadius: 8,
                    borderTopRightRadius: 8,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ fontSize: 13 }}>{t.icon ?? '▦'}</span>
                  <span>{t.name}</span>
                </Link>
              )
            })
          )}
          <button
            onClick={() => setModalOpen(true)}
            title="New table"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 'calc(var(--tabs-h) - 1px)',
              padding: '0 10px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
            }}
          >
            <PlusIcon size={14} />
          </button>
        </div>

        {/* Active table page */}
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>

      {/* Right chat sidebar (placeholder — Phase C wires it up) */}
      {chatOpen ? <ChatPanel onClose={() => setChatOpen(false)} /> : null}

      {modalOpen ? (
        <CreateTableModal onClose={() => setModalOpen(false)} onCreate={handleCreate} />
      ) : null}
    </div>
  )
}
