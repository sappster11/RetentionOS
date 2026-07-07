'use client'

// Approval cards for the client portal: Approve or Request changes (with a comment).
// Actions POST to /api/portal/[token]; state is local-optimistic per card.

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
    <div style={{ border: '1px solid #e4e4e6', borderRadius: 12, background: '#fff', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>{approval.title}</span>
        {approval.channel ? (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              color: '#5b7fa6',
              background: '#eaf1f9',
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
          {approval.preview ? <span style={{ color: '#8a8a8a' }}> — {approval.preview}</span> : null}
        </div>
      ) : null}
      {approval.body ? (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            background: '#fafafa',
            border: '1px solid #efeff1',
            borderRadius: 8,
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
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e7d4f' }}>✓ Approved — thank you!</span>
        ) : state === 'changes' ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: '#8a6d1a' }}>
            ✎ Feedback sent — we&apos;re on it.
          </span>
        ) : state === 'error' ? (
          <span style={{ fontSize: 13, color: '#b04632' }}>
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
                  border: '1px solid #dcdce0',
                  borderRadius: 8,
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
                  background: '#1e7d4f',
                  border: 'none',
                  borderRadius: 8,
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
                    color: '#5c5133',
                    background: '#f5edd6',
                    border: '1px solid #e2d9b8',
                    borderRadius: 8,
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
                    color: '#555',
                    background: '#fff',
                    border: '1px solid #dcdce0',
                    borderRadius: 8,
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
