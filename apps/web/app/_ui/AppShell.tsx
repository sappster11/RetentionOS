'use client'

// The outer app chrome: a slim top header (app mark + workspace name, chat toggle), the
// BASE bar (Airtable-style workspaces — Sales CRM / Client Hub / …), the table-TABS strip
// scoped to the active base, then the active table's page as children, then the collapsible
// chat panel. All chrome is light: white/near-white with 1px neutral borders.
//
// Base selection: navigating to a table activates its base (URL stays /t/[tableSlug] —
// tables are the routing unit, bases are grouping). Clicking a base chip switches the tab
// strip and jumps to that base's first table when it has one. Ungrouped tables (base_id
// null) live under a default "Workspace" chip that only renders when any exist.
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { EngineBase, EngineTable } from '@retentionos/engine'
import { api } from './apiClient'
import { ChatPanel } from './ChatPanel'
import { CreateBaseModal } from './CreateBaseModal'
import { CreateTableModal } from './CreateTableModal'
import { PlusIcon } from './icons'

/** Sentinel chip key for ungrouped tables (base_id null). Not a real base id. */
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

  const activeSlug = pathname.startsWith('/t/') ? pathname.split('/')[2] : null
  const activeTable = activeSlug ? tables.find((t) => t.slug === activeSlug) ?? null : null

  const ungrouped = useMemo(() => tables.filter((t) => !t.base_id), [tables])

  // Chip list: real bases in position order, then the Workspace chip iff ungrouped exist.
  const chips = useMemo(() => {
    const list: Array<{ key: string; name: string; icon: string | null }> = bases.map((b) => ({
      key: b.id,
      name: b.name,
      icon: b.icon,
    }))
    if (ungrouped.length > 0) list.push({ key: WORKSPACE_KEY, name: 'Workspace', icon: null })
    return list
  }, [bases, ungrouped])

  // The active base follows the active table; a chip click selects directly (and usually
  // also navigates, which re-derives the same key). selectedKey only leads when there's no
  // table context (e.g. an empty base, or no table open).
  const derivedKey = activeTable ? activeTable.base_id ?? WORKSPACE_KEY : null
  const [selectedKey, setSelectedKey] = useState<string | null>(derivedKey)
  useEffect(() => {
    if (derivedKey) setSelectedKey(derivedKey)
  }, [derivedKey])
  const activeKey = derivedKey ?? selectedKey ?? chips[0]?.key ?? null

  // The tab strip shows only the active base's tables.
  const visibleTables = useMemo(() => {
    if (!activeKey) return tables
    if (activeKey === WORKSPACE_KEY) return ungrouped
    return tables.filter((t) => t.base_id === activeKey)
  }, [tables, ungrouped, activeKey])

  // /login and /auth pages render bare (no shell chrome).
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    return <>{children}</>
  }

  function switchBase(key: string) {
    setSelectedKey(key)
    const target =
      key === WORKSPACE_KEY ? ungrouped : tables.filter((t) => t.base_id === key)
    // Already inside this base? Stay put. Otherwise jump to its first table (if any).
    if (activeTable && (activeTable.base_id ?? WORKSPACE_KEY) === key) return
    const first = target[0]
    if (first) router.push(`/t/${first.slug}`)
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
    const base = await api.createBase(input)
    setBaseModalOpen(false)
    setSelectedKey(base.id)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Main column: header + base bar + tabs + content */}
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

        {/* Base bar — one chip per base (+ Workspace for ungrouped) above the tab strip */}
        <div
          data-testid="base-bar"
          style={{
            height: 36,
            flexShrink: 0,
            background: 'var(--bg)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 10px',
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
        >
          {chips.map((chip) => {
            const active = chip.key === activeKey
            return (
              <button
                key={chip.key}
                onClick={() => switchBase(chip.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 11px',
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  background: active ? 'color-mix(in srgb, var(--accent) 10%, var(--bg))' : 'transparent',
                  border: active ? '1px solid color-mix(in srgb, var(--accent) 35%, var(--bg))' : '1px solid transparent',
                  borderRadius: 999,
                  whiteSpace: 'nowrap',
                }}
              >
                {chip.icon ? <span style={{ fontSize: 13 }}>{chip.icon}</span> : null}
                <span>{chip.name}</span>
              </button>
            )
          })}
          <button
            onClick={() => setBaseModalOpen(true)}
            title="New base"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
            }}
          >
            <PlusIcon size={13} />
          </button>
        </div>

        {/* Table tabs strip — only the active base's tables */}
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
          {visibleTables.length === 0 ? (
            <span style={{ color: 'var(--text-faint)', fontSize: 12, padding: '0 10px 10px' }}>
              {tables.length === 0
                ? 'No tables yet — click + to create one.'
                : 'No tables in this base yet — click + to create one.'}
            </span>
          ) : (
            visibleTables.map((t) => {
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
            onClick={() => setTableModalOpen(true)}
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

      {tableModalOpen ? (
        <CreateTableModal
          bases={bases}
          defaultBaseId={activeKey && activeKey !== WORKSPACE_KEY ? activeKey : null}
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
