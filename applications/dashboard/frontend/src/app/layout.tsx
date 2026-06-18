import type { Metadata, Viewport } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'POP Investment Planner', template: '%s | POP Investment Planner' },
  description: 'POP Investment Planner — AI-powered portfolio management and investment planning',
  keywords: ['investment', 'portfolio', 'analytics', 'fintech', 'AI'],
  robots: 'noindex, nofollow',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0B0F1A',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="font-sans bg-surface-base text-ink-primary antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
