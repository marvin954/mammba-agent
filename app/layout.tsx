import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'M.A.M.M.B.A Sales Agent',
  description: 'AI-powered outbound sales agent for M.A.M.M.B.A Enterprises LLC',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f9f9f9', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
