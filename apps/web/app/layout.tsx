import type { ReactNode } from 'react'

export const metadata = {
  title: 'RetentionOS',
  description: 'An owned, AI-native operating system for a retention agency.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background: '#0b0c0e',
          color: '#e7e9ee',
        }}
      >
        {children}
      </body>
    </html>
  )
}
