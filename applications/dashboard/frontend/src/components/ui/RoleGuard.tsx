'use client'

import { useAuthStore } from '@/store/auth'

type Role = 'admin' | 'analyst' | 'viewer'

interface RoleGuardProps {
  roles: Role[]
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function RoleGuard({ roles, children, fallback = null }: RoleGuardProps) {
  const user = useAuthStore((s) => s.user)
  if (!user || !roles.includes(user.role)) return <>{fallback}</>
  return <>{children}</>
}
