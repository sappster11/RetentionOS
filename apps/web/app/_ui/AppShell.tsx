'use client'

// The outer app chrome — clean left-nav dashboard (no Airtable-style tab strips):
// a fixed left sidebar (org mark, then one nav section per base with its tables as
// items, a Workspace section for ungrouped tables, + new-table/new-workspace actions),
// a slim top bar (breadcrumb + chat toggle), and the content area. The grid/kanban/
// filters/views machinery all lives in the table pages themselves and is unchanged.
//
// Navigation model: tables are the routing unit (/t/[tableSlug]); bases are grouping.
// The sidebar shows every base as a section, so there is no separate base switcher —
// everything is one click away.
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { EngineBase, EngineTable } from '@retentionos/engine'
import { api } from './apiClient'
import { ChatPanel } from './ChatPanel'
import { CreateBaseModal } from './CreateBaseModal'
import { CreateTableModal } from './CreateTableModal'
import { PlusIcon } from './icons'

/** Sentinel key for the ungrouped ("Workspace") section. Not a real base id. */
const WORKSPACE_KEY = '__workspace__'

export function AppShell({
  bases,
  tables,
  orgName,
  children,
}: {
  bases: EngineBase[]
  tables: EngineTable[]
  orgName: string
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [tableModalOpen, setTableModalOpen] = useState(false)
  const [baseModalOpen, setBaseModalOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const activeSlug = pathname.startsWith('/t/') ? pathname.split('/')[2] : null
  const activeTable = activeSlug ? tables.find((t) => t.slug === activeSlug) ?? null : null

  const ungrouped = useMemo(() => tables.filter((t) => !t.base_id), [tables])

  const sections = useMemo(() => {
    const list: Array<{ key: string; name: string; icon: string | null; tables: EngineTable[] }> =
      bases.map((b) => ({
        key: b.id,
        name: b.name,
        icon: b.icon,
        tables: tables.filter((t) => t.base_id === b.id),
      }))
    if (ungrouped.length > 0)
      list.push({ key: WORKSPACE_KEY, name: 'Workspace', icon: null, tables: ungrouped })
    return list
  }, [bases, tables, ungrouped])

  const activeBase = activeTable
    ? sections.find((s) => s.key === (activeTable.base_id ?? WORKSPACE_KEY)) ?? null
    : null

  // /login, /auth, public /f/ form pages, and the /retention/ analytics section render
  // bare (no shell chrome — retention has its own back link to the client record).
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/f/') ||
    pathname.startsWith('/retention/') ||
    pathname.startsWith('/c/')
  ) {
    return <>{children}</>
  }

  async function handleCreateTable(input: {
    name: string
    icon?: string
    description?: string
    baseId: string | null
  }) {
    const table = await api.createTable(input)
    setTableModalOpen(false)
    router.push(`/t/${table.slug}`)
    router.refresh()
  }

  async function handleCreateBase(input: { name: string; icon?: string }) {
    await api.createBase(input)
    setBaseModalOpen(false)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Left navigation */}
      <nav
        data-testid="left-nav"
        style={{
          width: 232,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-subtle, #fafafa)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {/* The wordmark (brand law: lowercase italic serif, never caps, never a tile). */}
        <div
          className="wordmark"
          style={{
            fontSize: 23,
            padding: '16px 16px 14px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {orgName.toLowerCase()}
          {orgName.trim().toLowerCase() === 'roam' ? <sup>®</sup> : null}
        </div>

        {/* Sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '2px 8px 8px' }}>
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 8px',
              margin: '0 0 10px',
              fontSize: 13,
              fontWeight: pathname === '/' ? 600 : 400,
              color: pathname === '/' ? 'var(--accent)' : 'var(--text-muted)',
              background:
                pathname === '/' ? 'color-mix(in srgb, var(--accent) 9%, transparent)' : 'transparent',
              borderRadius: 6,
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 13 }}>⌂</span>
            <span>Dashboard</span>
          </Link>
          {sections.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-faint)', padding: '8px 8px' }}>
              No workspaces yet — create one below.
            </div>
          ) : (
            sections.map((s) => {
              const isCollapsed = collapsed[s.key] ?? false
              return (
                <div key={s.key} style={{ marginBottom: 14 }}>
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [s.key]: !isCollapsed }))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                      padding: '4px 8px',
                      fontSize: 11.5,
                      fontWeight: 600,
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                      color: 'var(--text-faint)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        transition: 'transform 120ms',
                        transform: isCollapsed ? 'rotate(-90deg)' : 'none',
                        fontSize: 9,
                      }}
                    >
                      ▾
                    </span>
                    {s.icon ? <span style={{ fontSize: 12 }}>{s.icon}</span> : null}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </span>
                  </button>
                  {!isCollapsed
                    ? s.tables.map((t) => {
                        const active = activeSlug === t.slug
                        return (
                          <Link
                            key={t.id}
                            href={`/t/${t.slug}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '5px 8px 5px 22px',
                              margin: '1px 0',
                              fontSize: 13,
                              fontWeight: active ? 600 : 400,
                              color: active ? 'var(--accent)' : 'var(--text-muted)',
                              background: active
                                ? 'color-mix(in srgb, var(--accent) 9%, transparent)'
                                : 'transparent',
                              borderRadius: 6,
                              textDecoration: 'none',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            <span style={{ fontSize: 13, flexShrink: 0 }}>{t.icon ?? '▦'}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                          </Link>
                        )
                      })
                    : null}
                </div>
              )
            })
          )}
        </div>

        {/* Bottom actions */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <SidebarAction label="New table" onClick={() => setTableModalOpen(true)} />
          <SidebarAction label="New workspace" onClick={() => setBaseModalOpen(true)} />
        </div>
      </nav>

      {/* Main column: top bar + content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, minWidth: 0 }}>
            {activeBase ? (
              <>
                <span style={{ color: 'var(--text-faint)' }}>
                  {activeBase.icon ? `${activeBase.icon} ` : ''}
                  {activeBase.name}
                </span>
                <span style={{ color: 'var(--text-faint)' }}>/</span>
              </>
            ) : null}
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeTable ? `${activeTable.icon ? `${activeTable.icon} ` : ''}${activeTable.name}` : ''}
            </span>
          </div>
          <button
            onClick={() => setChatOpen((v) => !v)}
            style={{
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg)',
              color: 'var(--text-muted)',
              padding: '4px 10px',
              flexShrink: 0,
            }}
          >
            {chatOpen ? 'Hide chat' : 'Chat'}
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>

      {/* Right chat panel */}
      {chatOpen ? <ChatPanel onClose={() => setChatOpen(false)} /> : null}

      {tableModalOpen ? (
        <CreateTableModal
          bases={bases}
          defaultBaseId={activeTable?.base_id ?? null}
          onClose={() => setTableModalOpen(false)}
          onCreate={handleCreateTable}
        />
      ) : null}

      {baseModalOpen ? (
        <CreateBaseModal onClose={() => setBaseModalOpen(false)} onCreate={handleCreateBase} />
      ) : null}
    </div>
  )
}

function SidebarAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '5px 8px',
        fontSize: 12.5,
        color: 'var(--text-muted)',
        background: 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <PlusIcon size={12} />
      {label}
    </button>
  )
}
