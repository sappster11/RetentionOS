'use client'

// Chat sidebar PLACEHOLDER. Built as a real component (message list + input) so Phase C
// only has to wire it to the agent API. The input is intentionally disabled and nothing
// is sent anywhere yet.
export function ChatPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside
      style={{
        width: 'var(--chat-w)',
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-subtle)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <header
        style={{
          height: 44,
          flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        <span>Agent</span>
        <button
          onClick={onClose}
          title="Collapse"
          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 16 }}
        >
          ×
        </button>
      </header>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          gap: 10,
        }}
      >
        <div
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 12,
            color: 'var(--text-muted)',
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          The in-app agent isn&apos;t online yet. External agents already have full access to
          this workspace via MCP — the in-app chat gets wired up in Phase C.
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', padding: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            disabled
            placeholder="Agent chat coming online in Phase C"
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-hover)',
              color: 'var(--text-faint)',
            }}
          />
          <button
            disabled
            style={{
              padding: '0 12px',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-hover)',
              color: 'var(--text-faint)',
              cursor: 'not-allowed',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  )
}
