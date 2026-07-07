// Render smoke for the chat panel: server-render the component (hooks run, effects
// don't) and assert the chrome — including the conversation-history controls — renders
// without throwing. This is the keyless-safe path: no fetch fires during SSR, so this is
// exactly the markup a user gets before the probe resolves.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatPanel } from '../app/_ui/ChatPanel'

describe('ChatPanel — render smoke', () => {
  it('renders the header with new-conversation and history controls', () => {
    const html = renderToString(createElement(ChatPanel, { onClose: () => {} }))
    expect(html).toContain('Agent')
    expect(html).toContain('New conversation') // ＋ button title
    expect(html).toContain('Conversation history') // drawer toggle title
    expect(html).toContain('Connecting…') // pre-probe placeholder unchanged
    // Drawer starts closed — no list chrome until toggled.
    expect(html).not.toContain('No conversations yet.')
  })
})
