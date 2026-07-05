'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { EngineTable } from '@retentionos/engine'
import { api } from './apiClient'
import { ChatPanel } from './ChatPanel'
import { CreateTableModal } from './CreateTableModal'

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
  const [chatOpen, setChatOpen] = useState(true)

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
      {/* Left sidebar */}
      <aside
        style={{
          width: 'var(--sidebar-w)',
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-sidebar)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: 'var(--accent)' }}>◆</span>
          <span>{orgName}</span>
        </div>

        <div style={{ padding: '10px 10px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-faint)', fontWeight: 600 }}>
            Tables
          </span>
          <button
            onClick={() => setModalOpen(true)}
            title="New table"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            +
          </button>
        </div>

        <nav style={{ overflowY: 'auto', flex: 1, padding: '0 6px' }}>
          {tables.length === 0 ? (
            <p style={{ color: 'var(--text-faint)', fontSize: 12, padding: '4px 8px' }}>
              No tables yet. Click + to create one.
            </p>
          ) : (
            tables.map((t) => (
              <Link
                key={t.id}
                href={`/t/${t.slug}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 'var(--radius)',
                  marginBottom: 1,
                  background: activeSlug === t.slug ? 'var(--accent-soft)' : 'transparent',
                  color: activeSlug === t.slug ? 'var(--accent)' : 'var(--text)',
                  fontWeight: activeSlug === t.slug ? 500 : 400,
                }}
              >
                <span style={{ width: 16, textAlign: 'center' }}>{t.icon ?? '▦'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </span>
              </Link>
            ))
          )}
        </nav>

        <button
          onClick={() => setModalOpen(true)}
          style={{
            margin: 10,
            padding: '7px 10px',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius)',
            background: 'transparent',
            color: 'var(--text-muted)',
            textAlign: 'left',
          }}
        >
          + New table
        </button>
      </aside>

      {/* Main column */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <header
          style={{
            height: 44,
            flexShrink: 0,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
          }}
        >
          <div style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: 13 }} id="topbar-title" />
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

        <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>{children}</div>
      </main>

      {/* Right chat sidebar (placeholder — Phase C wires it up) */}
      {chatOpen ? <ChatPanel onClose={() => setChatOpen(false)} /> : null}

      {modalOpen ? (
        <CreateTableModal onClose={() => setModalOpen(false)} onCreate={handleCreate} />
      ) : null}
    </div>
  )
}
