'use client'

// Approval cards for the client portal: Approve or Request changes (with a comment).
// Actions POST to /api/portal/[token]; state is local-optimistic per card.
// Brand roles: ember = the action, moss = the confirmed outcome.

import { useState } from 'react'

interface Approval {
  id: string
  title: string
  channel: string | null
  subject: string | null
  preview: string | null
  body: string | null
}

export function PortalApprovals({ token, approvals }: { token: string; approvals: Approval[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8 }}>
      {approvals.map((a) => (
        <ApprovalCard key={a.id} token={token} approval={a} />
      ))}
    </div>
  )
}

function ApprovalCard({ token, approval }: { token: string; approval: Approval }) {
  const [state, setState] = useState<'open' | 'busy' | 'approved' | 'changes' | 'error'>('open')
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')

  async function act(action: 'approve' | 'request_changes') {
    setState('busy')
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId: approval.id, action, comment: comment || undefined }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setState(action === 'approve' ? 'approved' : 'changes')
    } catch {
      setState('error')
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--bg)',
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 16.5 }}>{approval.title}</span>
        {approval.channel ? (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              fontFamily: 'var(--mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            {approval.channel}
          </span>
        ) : null}
      </div>
      {approval.subject ? (
        <div style={{ fontSize: 13, marginTop: 8 }}>
          <strong>Subject:</strong> {approval.subject}
          {approval.preview ? (
            <span style={{ color: 'var(--text-muted)' }}> — {approval.preview}</span>
          ) : null}
        </div>
      ) : null}
      {approval.body ? (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '10px 12px',
            marginTop: 10,
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {approval.body}
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        {state === 'approved' ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--moss-text)' }}>
            ✓ Approved — thank you!
          </span>
        ) : state === 'changes' ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
            ✎ Feedback sent — we&apos;re on it.
          </span>
        ) : state === 'error' ? (
          <span style={{ fontSize: 13, color: 'var(--danger)' }}>
            Something went wrong — try again or ping us in Slack.
          </span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {showComment ? (
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What should change?"
                rows={3}
                style={{
                  width: '100%',
                  fontSize: 13,
                  padding: '8px 10px',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  resize: 'vertical',
                }}
              />
            ) : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => act('approve')}
                disabled={state === 'busy'}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#fff',
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  padding: '7px 16px',
                  cursor: 'pointer',
                  opacity: state === 'busy' ? 0.6 : 1,
                }}
              >
                Approve
              </button>
              {showComment ? (
                <button
                  onClick={() => act('request_changes')}
                  disabled={state === 'busy' || !comment.trim()}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text)',
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius)',
                    padding: '7px 16px',
                    cursor: 'pointer',
                    opacity: state === 'busy' || !comment.trim() ? 0.6 : 1,
                  }}
                >
                  Send feedback
                </button>
              ) : (
                <button
                  onClick={() => setShowComment(true)}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    background: 'var(--bg)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius)',
                    padding: '7px 16px',
                    cursor: 'pointer',
                  }}
                >
                  Request changes
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
