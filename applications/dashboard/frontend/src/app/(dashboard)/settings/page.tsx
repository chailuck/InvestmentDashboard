'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { User, Lock, Shield, Settings2, Save, Loader2, AlertCircle, FolderOpen, Calendar, CheckCircle2, XCircle, FlaskConical, Database, FileSpreadsheet, ExternalLink, ListChecks, Upload, Download, Plus, Trash2, ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/services/api'
import { usersService } from '@/services/users'
import { appConfigService } from '@/services/appConfig'
import { portfolioDbService } from '@/services/portfolioDb'
import { weeklyScanService } from '@/services/weeklyScan'
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

function PortfolioDataSourceSection() {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'excel' | 'db' | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    portfolioDbService.getMode().then(m => setMode(m as 'excel' | 'db'))
  }, [])

  const switchMode = async (next: 'excel' | 'db') => {
    if (next === mode) return
    setSaving(true)
    try {
      await portfolioDbService.setMode(next)
      setMode(next)
      // Invalidate sidebar's portfolio-mode cache so it updates immediately
      queryClient.invalidateQueries({ queryKey: ['portfolio-mode'] })
      toast.success(`Switched to ${next === 'excel' ? 'Excel' : 'Database'} mode`)
    } catch {
      toast.error('Failed to switch mode')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Portfolio Data Source" icon={Database}>
      <p className="text-xs text-ink-muted -mt-3">
        Choose how your portfolio data is stored and managed.
      </p>
      {mode === null ? (
        <div className="flex items-center gap-2 text-ink-muted text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Excel mode */}
            <button
              onClick={() => switchMode('excel')}
              disabled={saving}
              className={cn(
                'flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-all text-left',
                mode === 'excel'
                  ? 'border-brand-500/50 bg-brand-500/8'
                  : 'border-border hover:border-border-focus',
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className={cn('w-5 h-5', mode === 'excel' ? 'text-brand-400' : 'text-ink-muted')} />
                  <span className={cn('font-semibold text-sm', mode === 'excel' ? 'text-brand-400' : 'text-ink-secondary')}>
                    Excel File
                  </span>
                </div>
                {mode === 'excel' && <CheckCircle2 className="w-4 h-4 text-brand-400" />}
              </div>
              <p className="text-xs text-ink-muted leading-relaxed">
                Read positions from the Investment Tracking Excel file. Requires configuring file paths below.
              </p>
            </button>

            {/* DB mode */}
            <button
              onClick={() => switchMode('db')}
              disabled={saving}
              className={cn(
                'flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-all text-left',
                mode === 'db'
                  ? 'border-brand-500/50 bg-brand-500/8'
                  : 'border-border hover:border-border-focus',
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Database className={cn('w-5 h-5', mode === 'db' ? 'text-brand-400' : 'text-ink-muted')} />
                  <span className={cn('font-semibold text-sm', mode === 'db' ? 'text-brand-400' : 'text-ink-secondary')}>
                    Database
                  </span>
                </div>
                {mode === 'db' && <CheckCircle2 className="w-4 h-4 text-brand-400" />}
              </div>
              <p className="text-xs text-ink-muted leading-relaxed">
                Manage positions directly in the database. No Excel file needed.
              </p>
            </button>
          </div>

          {mode === 'db' && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-brand-500/8 border border-brand-500/20 text-brand-400 text-xs">
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span>Using database mode. Manage your positions in </span>
              <Link href="/settings/portfolio-db" className="font-medium underline underline-offset-2 flex items-center gap-1">
                Portfolio Manager <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// Reactive — invalidated by switchMode() so the page re-renders immediately
function usePortfolioMode() {
  const { data } = useQuery({
    queryKey: ['portfolio-mode'],
    queryFn: portfolioDbService.getMode,
    staleTime: 60_000,
  })
  return data ?? null
}

function AppConfigSection() {
  const queryClient = useQueryClient()
  const { data: cfg, isLoading } = useQuery({
    queryKey: ['app-config'],
    queryFn: appConfigService.get,
  })

  const [sourcePath, setSourcePath] = useState('')
  const [workingPath, setWorkingPath] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMsg, setTestMsg] = useState('')

  useEffect(() => {
    if (cfg && !initialized) {
      setSourcePath(cfg.excel_source_path ?? '')
      setWorkingPath(cfg.excel_working_path ?? '')
      setInitialized(true)
    }
  }, [cfg, initialized])

  const saveMutation = useMutation({
    mutationFn: () => appConfigService.update({
      excel_source_path: sourcePath,
      excel_working_path: workingPath,
    }),
    onSuccess: () => {
      toast.success('Configuration saved')
      queryClient.invalidateQueries({ queryKey: ['app-config'] })
      setTestState('idle')
    },
    onError: () => toast.error('Failed to save configuration'),
  })

  const testPath = async () => {
    if (!sourcePath.trim()) return
    setTestState('testing')
    setTestMsg('')
    try {
      const result = await appConfigService.testPath(sourcePath.trim())
      setTestState(result.ok ? 'ok' : 'fail')
      setTestMsg(result.message)
    } catch {
      setTestState('fail')
      setTestMsg('Could not reach backend.')
    }
  }

  return (
    <Section title="App Configuration" icon={Settings2}>
      <p className="text-xs text-ink-muted -mt-3">
        Configure where the backend reads the Investment tracking Excel file.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          <div className="skeleton h-10 rounded-lg" />
          <div className="skeleton h-10 rounded-lg" />
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); saveMutation.mutate() }} className="space-y-5">

          {/* Source path */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-ink-secondary flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-brand-400" />
              Source File Path
              <span className="ml-auto text-[10px] text-ink-disabled font-normal">container path</span>
            </label>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs flex-1"
                value={sourcePath}
                onChange={e => { setSourcePath(e.target.value); setTestState('idle') }}
                placeholder="/app/investment_data/Investment tracking.xlsx"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={testPath}
                disabled={!sourcePath.trim() || testState === 'testing'}
                title="Test if file exists"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-ink-muted hover:text-ink-primary hover:border-brand-500/40 transition-colors disabled:opacity-40 shrink-0"
              >
                {testState === 'testing'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <FlaskConical className="w-3.5 h-3.5" />}
                Test
              </button>
            </div>

            {/* Test result */}
            {testState !== 'idle' && testState !== 'testing' && (
              <div className={cn(
                'flex items-start gap-2 text-xs px-3 py-2 rounded-lg border',
                testState === 'ok'
                  ? 'text-gain bg-gain/5 border-gain/20'
                  : 'text-loss bg-loss/5 border-loss/20',
              )}>
                {testState === 'ok'
                  ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                {testMsg}
              </div>
            )}

            <div className="bg-surface-elevated/60 border border-border/40 rounded-lg p-3 space-y-1.5 text-[11px] text-ink-muted">
              <p className="font-medium text-ink-secondary">How this works</p>
              <p>The backend runs inside Docker. Your Windows path is mounted into the container via <code className="text-brand-300 bg-surface-card px-1 rounded">docker-compose.yml</code> volumes.</p>
              <p className="font-mono text-[10px] text-ink-disabled break-all">
                D:/Documents/Pop/AI Agents/InvestmentAgent01/investmentPlan
                <span className="text-brand-400 mx-1">→</span>
                /app/investment_data
              </p>
              <p>So a file at <span className="font-mono text-[10px]">…\investmentPlan\Investment tracking.xlsx</span> becomes <span className="font-mono text-[10px] text-brand-300">/app/investment_data/Investment tracking.xlsx</span> inside the container.</p>
              <p>When you press <strong className="text-ink-secondary">Refresh</strong> on the Portfolio page, the backend copies from this source path to the working copy and reloads all charts.</p>
            </div>
          </div>

          {/* Working copy path */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-ink-secondary flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-ink-muted" />
              Working Copy Path
              <span className="ml-auto text-[10px] text-ink-disabled font-normal">writable · inside container</span>
            </label>
            <input
              className="input font-mono text-xs opacity-75"
              value={workingPath}
              onChange={e => setWorkingPath(e.target.value)}
              placeholder="/app/uploads/investment_tracking.xlsx"
              spellCheck={false}
            />
            <p className="text-[11px] text-ink-disabled">
              Where the backend stores its writable copy. Change only if you have a custom mount. Default: <code className="text-brand-300">/app/uploads/investment_tracking.xlsx</code>
            </p>
          </div>

          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
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

// ── Per-list editor card ──────────────────────────────────────────────────────

import { type UserSymbolList, SCAN_MARKETS, type ScanMarket } from '@/services/weeklyScan'

function SymbolListCard({
  list,
  onSave,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  list: UserSymbolList
  onSave: (id: string, name: string, symbols: string[], market: ScanMarket) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  isFirst: boolean
  isLast: boolean
}) {
  const [open,    setOpen]    = useState(false)
  const [name,    setName]    = useState(list.name)
  const [market,  setMarket]  = useState<ScanMarket>(list.market)
  const [text,    setText]    = useState(list.symbols.join('\n'))
  const [saving,  setSaving]  = useState(false)
  const [deleting,setDeleting]= useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const symbols = text.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean)

  const save = async () => {
    setSaving(true)
    try {
      await onSave(list.id, name.trim() || list.name, symbols, market)
      toast.success(`Saved "${name}" — ${symbols.length} symbols`)
    } catch {
      toast.error('Failed to save')
    } finally { setSaving(false) }
  }

  const confirmDelete = async () => {
    if (!confirm(`Delete symbol list "${list.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try { await onDelete(list.id) }
    catch { toast.error('Failed to delete'); setDeleting(false) }
  }

  const importFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { setText(ev.target?.result as string ?? ''); toast.success('Imported — save to apply') }
    reader.readAsText(file)
    e.target.value = ''
  }

  const exportTxt = () => {
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name.replace(/\s+/g, '_')}.txt`
    a.click()
  }

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-elevated/50">
        <div className="flex flex-col gap-0.5 shrink-0">
          <button onClick={() => onMoveUp(list.id)} disabled={isFirst}
            className="text-ink-disabled hover:text-ink-muted disabled:opacity-20 transition-colors">
            <ChevronUp className="w-3 h-3" />
          </button>
          <button onClick={() => onMoveDown(list.id)} disabled={isLast}
            className="text-ink-disabled hover:text-ink-muted disabled:opacity-20 transition-colors">
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
        <GripVertical className="w-3.5 h-3.5 text-ink-disabled shrink-0" />
        <input value={name} onChange={e => setName(e.target.value)}
          className="flex-1 bg-transparent text-sm font-semibold text-ink-primary outline-none border-b border-transparent focus:border-brand-500/50 transition-colors"
          onBlur={() => name !== list.name && onSave(list.id, name.trim() || list.name, list.symbols, market).catch(() => {})} />
        <select value={market} onChange={e => {
            const m = e.target.value as ScanMarket
            setMarket(m)
            onSave(list.id, name.trim() || list.name, list.symbols, m).catch(() => {})
          }}
          className="shrink-0 bg-surface-elevated border border-border/50 rounded px-1.5 py-0.5 text-[10px] text-ink-secondary focus:outline-none focus:border-brand-500/50">
          {SCAN_MARKETS.map(m => (
            <option key={m.value} value={m.value} title={m.desc}>{m.label}</option>
          ))}
        </select>
        <span className="text-[10px] text-ink-disabled shrink-0">{symbols.length} symbols</span>
        <button onClick={() => setOpen(v => !v)}
          className="text-xs text-brand-400 hover:text-brand-300 transition-colors shrink-0 px-1.5">
          {open ? 'Close' : 'Edit'}
        </button>
        <button onClick={confirmDelete} disabled={deleting}
          className="text-ink-disabled hover:text-loss transition-colors shrink-0 disabled:opacity-40">
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
      {/* Expanded editor */}
      {open && (
        <div className="p-3 space-y-2 border-t border-border/40 bg-surface-base/30">
          <div className="flex gap-2 justify-end">
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-border text-ink-muted hover:text-ink-primary transition-colors">
              <Upload className="w-3 h-3" /> Import
            </button>
            <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={importFile} />
            <button onClick={exportTxt}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-border text-ink-muted hover:text-ink-primary transition-colors">
              <Download className="w-3 h-3" /> Export
            </button>
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
            className="input w-full font-mono text-xs py-2 leading-5" spellCheck={false}
            placeholder={'KBANK\nAOT\nPTTEP\n…'} style={{ resize: 'vertical' }} />
          <p className="text-[11px] text-ink-disabled">One symbol per line. Uppercased on save.</p>
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 px-4 py-1.5 text-sm">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      )}
    </div>
  )
}

// ── Symbol lists section ──────────────────────────────────────────────────────

function ScanListSection() {
  const [lists,    setLists]    = useState<UserSymbolList[]>([])
  const [loading,  setLoading]  = useState(true)
  const [newName,  setNewName]  = useState('')
  const [creating, setCreating] = useState(false)

  const reload = () =>
    weeklyScanService.getSymbolLists()
      .then(setLists)
      .catch(() => toast.error('Failed to load symbol lists'))
      .finally(() => setLoading(false))

  useEffect(() => { reload() }, [])

  const handleSave = async (id: string, name: string, symbols: string[], market: ScanMarket) => {
    await weeklyScanService.updateSymbolList(id, { name, symbols, market })
    await reload()
  }

  const handleDelete = async (id: string) => {
    await weeklyScanService.deleteSymbolList(id)
    await reload()
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await weeklyScanService.createSymbolList(newName.trim(), [])
      setNewName('')
      await reload()
      toast.success(`Created "${newName.trim()}"`)
    } catch {
      toast.error('Failed to create list')
    } finally { setCreating(false) }
  }

  const move = async (id: string, dir: 1 | -1) => {
    const idx = lists.findIndex(l => l.id === id)
    if (idx < 0) return
    const swap = lists[idx + dir]
    if (!swap) return
    await Promise.all([
      weeklyScanService.updateSymbolList(id, { sort_order: swap.sort_order }),
      weeklyScanService.updateSymbolList(swap.id, { sort_order: lists[idx].sort_order }),
    ])
    await reload()
  }

  return (
    <Section title="Symbol Lists" icon={ListChecks}>
      <p className="text-xs text-ink-muted -mt-3">
        Named symbol lists used when creating a Weekly Scan. Each list becomes a separate tab in the scan view.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-2">
          {lists.length === 0 && (
            <p className="text-xs text-ink-disabled italic">No symbol lists yet. Create one below.</p>
          )}
          {lists.map((list, i) => (
            <SymbolListCard key={list.id} list={list}
              onSave={handleSave} onDelete={handleDelete}
              onMoveUp={id => move(id, -1)} onMoveDown={id => move(id, 1)}
              isFirst={i === 0} isLast={i === lists.length - 1} />
          ))}

          {/* Add new list */}
          <div className="flex gap-2 pt-2">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="New list name…"
              className="input flex-1 text-sm py-1.5" />
            <button onClick={handleCreate} disabled={!newName.trim() || creating}
              className="btn-primary flex items-center gap-1.5 px-4 py-1.5 text-sm disabled:opacity-40">
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add List
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

export default function SettingsPage() {
  const { user, setUser } = useAuthStore()
  const portfolioMode = usePortfolioMode()

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

      {/* Portfolio data source toggle */}
      <PortfolioDataSourceSection />

      {/* App Config — only shown in Excel mode */}
      {portfolioMode !== 'db' && <AppConfigSection />}

      {/* Scan list config */}
      <ScanListSection />

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
