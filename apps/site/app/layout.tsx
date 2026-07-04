import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

// "RetentionOS" is a placeholder brand name for the agency — the owner can
// rename it freely; every reference lives in this app, not in shared code.

export const metadata: Metadata = {
  title: 'RetentionOS — AI-native retention',
  description:
    'RetentionOS is an AI-native retention agency for DTC brands: own your data, ship data-backed lifecycle campaigns, and run operations on agentic infrastructure. Book a call.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
