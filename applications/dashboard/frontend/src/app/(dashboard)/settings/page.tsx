'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { User, Lock, Shield, Settings2, Save, Loader2, AlertCircle, FolderOpen, Calendar } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/services/api'
import { usersService } from '@/services/users'
import { appConfigService } from '@/services/appConfig'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

const ROLE_LABELS: Record<string, string> = {
  admin:   'Administrator',
  analyst: 'Analyst',
  viewer:  'Viewer',
}

const ROLE_COLORS: Record<string, string> = {
  admin:   'bg-purple-500/15 text-purple-400 border-purple-500/20',
  analyst: 'bg-brand-500/15 text-brand-400 border-brand-500/20',
  viewer:  'bg-surface-elevated text-ink-muted border-border',
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-6 space-y-5">
      <h2 className="text-base font-semibold text-ink-primary flex items-center gap-2">
        <Icon className="w-4 h-4 text-brand-400" />{title}
      </h2>
      {children}
    </motion.div>
  )
}

function AppConfigSection() {
  const queryClient = useQueryClient()
  const { data: cfg, isLoading } = useQuery({
    queryKey: ['app-config'],
    queryFn: appConfigService.get,
  })
  const [sourcePath, setSourcePath] = useState('')
  const [initialized, setInitialized] = useState(false)

  if (cfg && !initialized) {
    setSourcePath(cfg.excel_source_path ?? '')
    setInitialized(true)
  }

  const mutation = useMutation({
    mutationFn: (path: string) => appConfigService.update({ excel_source_path: path }),
    onSuccess: () => {
      toast.success('Configuration saved')
      queryClient.invalidateQueries({ queryKey: ['app-config'] })
    },
    onError: () => toast.error('Failed to save configuration'),
  })

  return (
    <Section title="App Configuration" icon={Settings2}>
      <p className="text-xs text-ink-muted -mt-3">Configure data source paths for the portfolio tracker.</p>
      {isLoading ? (
        <div className="skeleton h-10 rounded-lg" />
      ) : (
        <form onSubmit={e => { e.preventDefault(); mutation.mutate(sourcePath) }} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5 flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-ink-muted" />
              Excel Source Path (inside container)
            </label>
            <input className="input font-mono text-xs" value={sourcePath}
              onChange={e => setSourcePath(e.target.value)}
              placeholder="/app/investment_data/Investment tracking.xlsx" />
            <p className="text-xs text-ink-disabled mt-1">
              Path to the Investment tracking.xlsx file mounted in the backend container. Used when the Refresh button is clicked on the Portfolio page.
            </p>
          </div>
          <button type="submit" disabled={mutation.isPending}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Configuration
          </button>
        </form>
      )}
    </Section>
  )
}

function PortfolioPrefsSection() {
  const [months, setMonths] = useState(3)

  useEffect(() => {
    const stored = parseInt(localStorage.getItem('portfolio_default_months') ?? '3', 10)
    if (!isNaN(stored) && stored > 0) setMonths(stored)
  }, [])

  const save = () => {
    localStorage.setItem('portfolio_default_months', String(months))
    // Clear persisted criteria so next visit uses new default
    localStorage.removeItem('portfolio_criteria')
    toast.success(`Default period set to ${months} month${months !== 1 ? 's' : ''}`)
  }

  return (
    <Section title="Portfolio Preferences" icon={Calendar}>
      <p className="text-xs text-ink-muted -mt-3">Default date range when opening the Portfolio page.</p>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Default History Period (months)
          </label>
          <div className="flex items-center gap-3">
            <input type="number" min={1} max={36} value={months}
              onChange={e => setMonths(Math.max(1, Math.min(36, parseInt(e.target.value) || 3)))}
              className="input w-24 text-sm py-1.5" />
            <span className="text-xs text-ink-muted">months back from today</span>
          </div>
          <p className="text-xs text-ink-disabled mt-1">Range: 1–36 months. Default is 3 months.</p>
        </div>
        <div className="flex gap-1">
          {[1, 3, 6, 12].map(m => (
            <button key={m} onClick={() => setMonths(m)}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                months === m
                  ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                  : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated')}>
              {m}M
            </button>
          ))}
        </div>
        <button onClick={save} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
          <Save className="w-4 h-4" />
          Save Preference
        </button>
      </div>
    </Section>
  )
}

export default function SettingsPage() {
  const { user, setUser } = useAuthStore()

  // Profile form
  const [name, setName] = useState(user?.name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  // Password form
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [savingPassword, setSavingPassword] = useState(false)
  const [pwError, setPwError] = useState('')

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSavingProfile(true)
    try {
      const { data } = await apiClient.put('/auth/me', { name: name.trim() })
      setUser({ ...user!, name: data.name })
      toast.success('Profile updated')
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    if (passwords.next !== passwords.confirm) {
      setPwError('New passwords do not match')
      return
    }
    if (passwords.next.length < 8) {
      setPwError('Password must be at least 8 characters')
      return
    }
    setSavingPassword(true)
    try {
      await usersService.changeOwnPassword(passwords.current, passwords.next)
      setPasswords({ current: '', next: '', confirm: '' })
      toast.success('Password changed successfully')
    } catch (err: any) {
      setPwError(err?.response?.data?.detail ?? 'Failed to change password')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-primary">Account Settings</h1>
        <p className="text-ink-muted text-sm mt-0.5">Manage your profile and security preferences</p>
      </div>

      {/* Profile */}
      <Section title="Profile Information" icon={User}>
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-400 to-purple-400 flex items-center justify-center text-lg font-bold text-white">
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div>
            <p className="font-semibold text-ink-primary">{user?.name}</p>
            <p className="text-xs text-ink-muted">{user?.email}</p>
          </div>
          <span className={cn('ml-auto px-2.5 py-1 rounded-full text-xs font-medium border', ROLE_COLORS[user?.role ?? 'viewer'])}>
            {ROLE_LABELS[user?.role ?? 'viewer']}
          </span>
        </div>

        <form onSubmit={saveProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">Full Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">Email address</label>
            <input className="input opacity-60 cursor-not-allowed" value={user?.email ?? ''} disabled
              title="Contact an admin to change your email" />
            <p className="text-xs text-ink-disabled mt-1">Email changes require admin assistance.</p>
          </div>
          <button type="submit" disabled={savingProfile || !name.trim() || name === user?.name}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
            {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Profile
          </button>
        </form>
      </Section>

      {/* Password */}
      <Section title="Change Password" icon={Lock}>
        {pwError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />{pwError}
          </div>
        )}
        <form onSubmit={savePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">Current Password</label>
            <input type="password" className="input" value={passwords.current}
              onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">New Password</label>
            <input type="password" className="input" value={passwords.next} minLength={8}
              onChange={e => setPasswords(p => ({ ...p, next: e.target.value }))} required placeholder="Min. 8 characters" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">Confirm New Password</label>
            <input type="password" className="input" value={passwords.confirm}
              onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))} required />
          </div>
          <button type="submit" disabled={savingPassword || !passwords.current || !passwords.next || !passwords.confirm}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
            {savingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Change Password
          </button>
        </form>
      </Section>

      {/* Portfolio preferences — all users */}
      <PortfolioPrefsSection />

      {/* App Config — admin only */}
      {user?.role === 'admin' && <AppConfigSection />}

      {/* Account Info */}
      <Section title="Account Details" icon={Shield}>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          {[
            { label: 'User ID', value: user?.id?.slice(0, 8) + '…' },
            { label: 'Role', value: ROLE_LABELS[user?.role ?? 'viewer'] },
            { label: 'Member since', value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—' },
            { label: 'Account status', value: 'Active' },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-ink-muted text-xs">{label}</dt>
              <dd className="font-medium text-ink-primary mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  )
}
