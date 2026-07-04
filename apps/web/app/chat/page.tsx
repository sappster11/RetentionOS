import Link from 'next/link'
import {
  getConversation,
  listConversationMessages,
  listConversations,
  type ConversationMessage,
} from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'
import { Card, inputStyle, buttonStyle, linkStyle, formatDate } from '../_components/ui'
import { askAction, type Citation } from './actions'

export const dynamic = 'force-dynamic'

function isCitation(value: unknown): value is Citation {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.type === 'string'
  )
}

/** ConversationMessage#citations is stored as `unknown[]` (jsonb) — narrow before use. */
function citationsOf(message: ConversationMessage): Citation[] {
  return message.citations.filter(isCitation)
}

const chipStyle = {
  ...linkStyle,
  fontSize: '0.7rem',
  background: '#20242a',
  border: '1px solid #2c2e33',
  borderRadius: 999,
  padding: '0.15rem 0.6rem',
  whiteSpace: 'nowrap' as const,
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user'
  const citations = isUser ? [] : citationsOf(message)
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: '1.1rem',
      }}
    >
      <div style={{ maxWidth: '80%' }}>
        <div
          style={{
            fontSize: '0.7rem',
            opacity: 0.5,
            marginBottom: '0.25rem',
            textAlign: isUser ? 'right' : 'left',
          }}
        >
          {isUser ? 'You' : 'Assistant'} · {formatDate(message.created_at)}
        </div>
        <div
          style={{
            background: isUser ? '#173a2a' : '#1a1c20',
            border: '1px solid #24262b',
            borderRadius: 10,
            padding: '0.75rem 1rem',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message.content}
        </div>
        {citations.length > 0 ? (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            {citations.map((citation, index) => (
              <Link key={`${citation.url}-${index}`} href={citation.url} style={chipStyle}>
                {citation.title} · {citation.type}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  const { c: conversationId } = await searchParams
  const org = await getCurrentOrg()

  const [conversations, activeConversation, messages] = await Promise.all([
    listConversations(org.id, { limit: 30 }),
    conversationId ? getConversation(org.id, conversationId) : Promise.resolve(null),
    conversationId ? listConversationMessages(org.id, conversationId) : Promise.resolve([]),
  ])

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}
      >
        <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Chat with everything</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <Link href="/dashboard" style={linkStyle}>
            Dashboard →
          </Link>
          <Link href="/clients" style={linkStyle}>
            Clients →
          </Link>
        </div>
      </div>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>{org.name}</p>

      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.5rem', alignItems: 'flex-start' }}>
        <aside style={{ width: 220, flexShrink: 0 }}>
          <Card title="Conversations">
            <Link
              href="/chat"
              style={{ ...linkStyle, fontWeight: 600, display: 'block', marginBottom: '0.75rem' }}
            >
              + New chat
            </Link>
            {conversations.length === 0 ? (
              <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>No conversations yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {conversations.map((conv) => (
                  <li key={conv.id} style={{ padding: '0.35rem 0' }}>
                    <Link
                      href={`/chat?c=${conv.id}`}
                      style={{
                        ...linkStyle,
                        fontWeight: conv.id === activeConversation?.id ? 700 : 400,
                        opacity: conv.id === activeConversation?.id ? 1 : 0.75,
                        fontSize: '0.85rem',
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {conv.title ?? 'Untitled chat'}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Card>
            {!activeConversation || messages.length === 0 ? (
              <p style={{ opacity: 0.6 }}>
                Ask anything about your clients, customers, tasks, campaigns, or docs.
              </p>
            ) : (
              <div>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            )}
          </Card>

          <form action={askAction} style={{ display: 'flex', gap: '0.75rem' }}>
            <input type="hidden" name="conversation_id" value={activeConversation?.id ?? ''} />
            <input
              name="q"
              required
              placeholder="Ask about a client, campaign, task, or doc…"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="submit" style={buttonStyle}>
              Ask
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
