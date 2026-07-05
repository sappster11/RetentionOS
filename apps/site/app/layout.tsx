import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'roam — a retention studio', template: '%s — roam' },
  description:
    'Roam is a retention studio for commerce brands. Email, SMS, loyalty and lifecycle — engineered so your best customers buy again.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
