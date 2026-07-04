const LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#approach', label: 'Approach' },
  { href: '#results', label: 'Results' },
]

// Hardcoded rather than `new Date().getFullYear()` so this Server Component
// stays a plain static render (no per-request clock read to worry about).
// Bump manually, or swap in a build-time env var if that matters later.
const YEAR = 2026

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <a href="#" className="wordmark">
            <span className="wordmark__mark" aria-hidden="true" />
            RetentionOS
          </a>
          <span className="footer__tagline">Built on RetentionOS — our own platform, running our own agency.</span>
        </div>

        <nav className="footer__nav" aria-label="Footer">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <span className="footer__legal">&copy; {YEAR} RetentionOS. All rights reserved.</span>
      </div>
    </footer>
  )
}
