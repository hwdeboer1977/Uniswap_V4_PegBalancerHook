import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Soft Peg Mechanism',
  description: 'Interactive dashboard for soft peg token mechanism',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
