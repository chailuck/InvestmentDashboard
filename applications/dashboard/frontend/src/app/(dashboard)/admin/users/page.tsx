'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Plus, Search, Shield, Eye, Edit2, Ban, CheckCircle,
  Key, X, ChevronLeft, ChevronRight, AlertCircle, Loader2, Copy,
} from 'lucide-react'
import { usersService, type CreateUserPayload, type UpdateUserPayload } from '@/services/users'
import { CloneUserModal } from '@/components/admin/CloneUserModal'
import type { UserDetail } from '@/types'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { RoleGuard } from '@/components/ui/RoleGuard'
import { useRouter } from 'next/navigation'

const ROLE_COLORS: Record<string, string> = {
  admin:   'bg-purple-500/15 text-purple-400 border-purple-500/20',
  analyst: 'bg-brand-500/15 text-brand-400 border-brand-500/20',
  viewer:  'bg-surface-elevated text-ink-muted border-border',
}

const ROLE_ICONS: Record<string, React.ElementType> = {
  admin:   Shield,
  analyst: BarChart,
  viewer:  Eye,
}

function BarChart(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

interface UserModalProps {
  user?: UserDetail | null
  onClose: () => void
  onSaved: () => void
}

function UserModal({ user, onClose, onSaved }: UserModalProps) {
  const isEdit = !!user
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    role: (user?.role ?? 'viewer') as 'admin' | 'analyst' | 'viewer',
    is_active: user?.is_active ?? true,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isEdit) {
        const payload: UpdateUserPayload = { name: form.name, email: form.email, role: form.role, is_active: form.is_active }
        await usersService.update(user!.id, payload)
        toast.success('User updated')
      } else {
        await usersService.create(form as CreateUserPayload)
        toast.success('User created')
      }
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative card p-6 w-full max-w-md z-10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-ink-primary">{isEdit ? 'Edit User' : 'Create User'}</h2>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">Full Name</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">Email</label>
            <input type="email" className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          </div>
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">Password</label>
              <input type="password" className="input" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                minLength={8} required placeholder="Min. 8 characters" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">Role</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as any }))}>
              <option value="viewer">Viewer</option>
              <option value="analyst">Analyst</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {isEdit && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded border-border bg-surface-elevated accent-brand-500" />
              <span className="text-sm text-ink-secondary">Active</span>
            </label>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-border text-ink-secondary text-sm hover:bg-surface-elevated transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 py-2 text-sm">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : isEdit ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

interface ResetPasswordModalProps {
  user: UserDetail
  onClose: () => void
}

function ResetPasswordModal({ user, onClose }: ResetPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await usersService.adminResetPassword(user.id, password)
      toast.success(`Password reset for ${user.name}`)
      onClose()
    } catch {
      toast.error('Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} className="relative card p-6 w-full max-w-sm z-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-ink-primary">Reset Password</h2>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-ink-muted mb-4">Set a new password for <span className="text-ink-primary font-medium">{user.name}</span>.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)}
            minLength={8} required placeholder="New password (min. 8 chars)" />
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-border text-ink-secondary text-sm hover:bg-surface-elevated transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 py-2 text-sm">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Reset'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

export default function AdminUsersPage() {
  const router = useRouter()
  const currentUser = useAuthStore(s => s.user)

  const [users, setUsers] = useState<UserDetail[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 15

  const [modalUser, setModalUser] = useState<UserDetail | null | undefined>(undefined) // undefined = closed
  const [resetUser, setResetUser] = useState<UserDetail | null>(null)
  const [cloneSourceUser, setCloneSourceUser] = useState<UserDetail | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { page, page_size: PAGE_SIZE }
      if (search) params.search = search
      if (roleFilter) params.role = roleFilter
      if (statusFilter === 'active') params.is_active = true
      if (statusFilter === 'inactive') params.is_active = false
      const res = await usersService.list(params)
      setUsers(res.users)
      setTotal(res.total)
    } catch {
      toast.error('Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [page, search, roleFilter, statusFilter])

  useEffect(() => { load() }, [load])

  // Redirect non-admins
  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin') router.push('/dashboard')
  }, [currentUser, router])

  const toggleActive = async (user: UserDetail) => {
    try {
      if (user.is_active) {
        await usersService.deactivate(user.id)
        toast.success(`${user.name} deactivated`)
      } else {
        await usersService.activate(user.id)
        toast.success(`${user.name} activated`)
      }
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Action failed')
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <RoleGuard roles={['admin']} fallback={<div className="flex-1 flex items-center justify-center text-ink-muted">Access denied</div>}>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink-primary flex items-center gap-2">
              <Users className="w-6 h-6 text-brand-400" /> User Management
            </h1>
            <p className="text-ink-muted text-sm mt-0.5">{total} users total</p>
          </div>
          <button onClick={() => setModalUser(null)} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
            <Plus className="w-4 h-4" /> New User
          </button>
        </div>

        {/* Filters */}
        <div className="card p-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
            <input className="input pl-9 w-full" placeholder="Search name or email…"
              value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <select className="input w-36" value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1) }}>
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="analyst">Analyst</option>
            <option value="viewer">Viewer</option>
          </select>
          <select className="input w-36" value={statusFilter} onChange={e => { setStatusFilter(e.target.value as any); setPage(1) }}>
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  {['User', 'Role', 'Status', 'Last Login', 'Created', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {loading ? (
                  <tr><td colSpan={6} className="py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-brand-400 mx-auto" />
                  </td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-ink-muted">No users found</td></tr>
                ) : users.map(user => (
                  <motion.tr key={user.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-purple-400 flex items-center justify-center text-xs font-bold text-white shrink-0">
                          {user.name[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-ink-primary">{user.name}
                            {user.id === currentUser?.id && <span className="ml-1.5 text-[10px] text-brand-400">(you)</span>}
                          </p>
                          <p className="text-xs text-ink-muted">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', ROLE_COLORS[user.role])}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                        user.is_active ? 'bg-gain/10 text-gain border border-gain/20' : 'bg-loss/10 text-loss border border-loss/20')}>
                        {user.is_active ? <CheckCircle className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs">
                      {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setModalUser(user)} className="btn-icon" title="Edit">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setResetUser(user)} className="btn-icon" title="Reset password">
                          <Key className="w-3.5 h-3.5" />
                        </button>
                        {user.id !== currentUser?.id && (
                          <button
                            onClick={() => setCloneSourceUser(user)}
                            className="btn-icon"
                            title="Clone user data"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {user.id !== currentUser?.id && (
                          <button onClick={() => toggleActive(user)}
                            className={cn('btn-icon', user.is_active ? 'text-loss hover:bg-loss/10' : 'text-gain hover:bg-gain/10')}
                            title={user.is_active ? 'Deactivate' : 'Activate'}>
                            {user.is_active ? <Ban className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
              <span className="text-xs text-ink-muted">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-1">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="btn-icon disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                  className="btn-icon disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {modalUser !== undefined && (
          <UserModal user={modalUser} onClose={() => setModalUser(undefined)} onSaved={load} />
        )}
        {resetUser && (
          <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} />
        )}
        {cloneSourceUser && (
          <CloneUserModal
            sourceUser={cloneSourceUser}
            allUsers={users}
            onClose={() => setCloneSourceUser(null)}
            onSuccess={load}
          />
        )}
      </AnimatePresence>
    </RoleGuard>
  )
}
