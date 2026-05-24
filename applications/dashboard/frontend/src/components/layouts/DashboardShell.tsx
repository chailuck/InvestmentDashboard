'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useAuthStore } from '@/store/auth'
import { useRouter } from 'next/navigation'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':             'Dashboard',
  '/portfolio':             'Portfolio',
  '/analytics':            'Analytics',
  '/ai-copilot':           'AI Copilot',
  '/settings':             'Settings',
  '/admin/users':          'User Management',
  '/settings/documents':   'Documentation',
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const { accessToken } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (!accessToken) router.replace('/login')
  }, [accessToken, router])

  if (!accessToken) return null

  const pageTitle = PAGE_TITLES[pathname] ?? 'Dashboard'

  return (
    <div className="flex h-screen overflow-hidden bg-surface-base">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header
          onMobileMenuOpen={() => setMobileMenuOpen(true)}
          pageTitle={pageTitle}
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
