'use client'

import { useState } from 'react'
import { BOOK_CALL_HREF } from './constants'

const LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#approach', label: 'Approach' },
  { href: '#results', label: 'Results' },
]

export function TopBar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="topbar">
      <div className="container topbar__inner">
        <a href="#" className="wordmark">
          <span className="wordmark__mark" aria-hidden="true" />
          RetentionOS
        </a>

        <nav className="nav" aria-label="Primary">
          <div className="nav__links">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
          <a href={BOOK_CALL_HREF} className="btn btn--primary btn--sm">
            Book a call
          </a>
          <button
            type="button"
            className="nav__toggle"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="nav__toggle-bars" aria-hidden="true">
              <span />
              <span />
            </span>
          </button>
        </nav>
      </div>

      <div className="nav__mobile" id="mobile-nav" data-open={open}>
        {LINKS.map((link) => (
          <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
            {link.label}
          </a>
        ))}
        <a href={BOOK_CALL_HREF} className="btn btn--primary" onClick={() => setOpen(false)}>
          Book a call
        </a>
      </div>
    </header>
  )
}
