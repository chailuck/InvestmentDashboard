'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { User, Lock, Shield, Save, Loader2, AlertCircle, FolderOpen, Calendar, CheckCircle2, XCircle, FlaskConical, Database, FileSpreadsheet, ExternalLink, ListChecks, Upload, Download, Plus, Trash2, ChevronDown, ChevronUp, GripVertical, RefreshCw, Wallet, Star, Mail, Send } from 'lucide-react'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/services/api'
import { usersService } from '@/services/users'
import { appConfigService } from '@/services/appConfig'
import { portfolioDbService } from '@/services/portfolioDb'
import { weeklyScanService } from '@/services/weeklyScan'
import { portfolioService, type UserPortfolio, type PortfolioCreate, type PortfolioUpdate } from '@/services/portfolio'
import { emailDigestService, type EmailDigestSettings } from '@/services/emailDigest'
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

// ── Portfolio Management Section ────────────────────────────────────────────────

function PortfolioCard({
  portfolio,
  canDelete,
  onSetDefault,
  onUpdate,
  onDelete,
}: {
  portfolio: UserPortfolio
  canDelete: boolean
  onSetDefault: (id: string) => Promise<void>
  onUpdate: (id: string, data: PortfolioUpdate) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [expanded, setExpanded]       = useState(portfolio.is_default)
  const [name, setName]               = useState(portfolio.name)
  const [mode, setMode]               = useState<'excel' | 'db'>(portfolio.portfolio_mode)
  const [sourcePath, setSourcePath]   = useState(portfolio.excel_source_path ?? '')
  const [workingPath, setWorkingPath] = useState(portfolio.excel_working_path ?? '')
  const [saving, setSaving]           = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [settingDefault, setSettingDefault] = useState(false)
  const [testState, setTestState]     = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMsg, setTestMsg]         = useState('')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onUpdate(portfolio.id, {
        name: name.trim() || portfolio.name,
        portfolio_mode: mode,
        excel_source_path: mode === 'excel' ? sourcePath.trim() || null : null,
        excel_working_path: mode === 'excel' ? workingPath.trim() || null : null,
      })
      toast.success(`Portfolio "${name}" saved`)
    } catch {
      toast.error('Failed to save portfolio')
    } finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!confirm(`Delete portfolio "${portfolio.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try { await onDelete(portfolio.id) }
    catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to delete')
      setDeleting(false)
    }
  }

  const testPath = async () => {
    if (!sourcePath.trim()) return
    setTestState('testing'); setTestMsg('')
    try {
      const r = await appConfigService.testPath(sourcePath.trim())
      setTestState(r.ok ? 'ok' : 'fail'); setTestMsg(r.message)
    } catch { setTestState('fail'); setTestMsg('Could not reach backend.') }
  }

  return (
    <div className={cn(
      'border rounded-xl overflow-hidden',
      portfolio.is_default ? 'border-brand-500/30 bg-brand-500/4' : 'border-border',
    )}>
      {/* Card header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Wallet className={cn('w-4 h-4 shrink-0', portfolio.is_default ? 'text-brand-400' : 'text-ink-muted')} />
        <span className={cn('font-semibold text-sm flex-1', portfolio.is_default ? 'text-brand-400' : 'text-ink-primary')}>
          {portfolio.name}
        </span>
        {portfolio.is_default && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-500/20 text-brand-400 font-bold border border-brand-500/30">
            DEFAULT
          </span>
        )}
        <span className={cn(
          'text-[10px] px-1.5 py-0.5 rounded border',
          mode === 'excel'
            ? 'text-amber-400 border-amber-500/30 bg-amber-500/8'
            : 'text-brand-400 border-brand-500/30 bg-brand-500/8',
        )}>
          {mode === 'excel' ? 'Excel' : 'DB'}
        </span>
        {!portfolio.is_default && (
          <button
            onClick={async () => { setSettingDefault(true); await onSetDefault(portfolio.id).finally(() => setSettingDefault(false)) }}
            disabled={settingDefault}
            title="Set as default"
            className="text-ink-disabled hover:text-amber-400 transition-colors disabled:opacity-40"
          >
            {settingDefault ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
          </button>
        )}
        <button onClick={() => setExpanded(v => !v)} className="text-ink-muted hover:text-ink-primary transition-colors">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {canDelete && (
          <button onClick={doDelete} disabled={deleting}
            className="text-ink-disabled hover:text-loss transition-colors disabled:opacity-40">
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Expanded editor */}
      {expanded && (
        <form onSubmit={save} className="px-4 pb-4 space-y-4 border-t border-border/40">
          {/* Name */}
          <div className="pt-4 space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Portfolio Name</label>
            <input className="input text-sm w-full" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          {/* Mode toggle */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Data Source</label>
            <div className="grid grid-cols-2 gap-2">
              {(['excel', 'db'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-left transition-all text-xs',
                    mode === m
                      ? 'border-brand-500/50 bg-brand-500/8'
                      : 'border-border hover:border-brand-500/30',
                  )}>
                  {m === 'excel'
                    ? <FileSpreadsheet className={cn('w-4 h-4', mode === 'excel' ? 'text-brand-400' : 'text-ink-muted')} />
                    : <Database className={cn('w-4 h-4', mode === 'db' ? 'text-brand-400' : 'text-ink-muted')} />}
                  <span className={cn('font-medium', mode === m ? 'text-brand-400' : 'text-ink-secondary')}>
                    {m === 'excel' ? 'Excel File' : 'Database'}
                  </span>
                  {mode === m && <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 ml-auto" />}
                </button>
              ))}
            </div>
          </div>

          {/* Excel paths — only when excel mode */}
          {mode === 'excel' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-ink-secondary flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5 text-brand-400" />
                  Source File Path
                  <span className="ml-auto text-[10px] text-ink-disabled font-normal">container path</span>
                </label>
                <div className="flex gap-2">
                  <input className="input font-mono text-xs flex-1" value={sourcePath}
                    onChange={e => { setSourcePath(e.target.value); setTestState('idle') }}
                    placeholder="/app/investment_data/Investment tracking.xlsx" spellCheck={false} />
                  <button type="button" onClick={testPath}
                    disabled={!sourcePath.trim() || testState === 'testing'}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium
                               text-ink-muted hover:text-ink-primary hover:border-brand-500/40 transition-colors disabled:opacity-40 shrink-0">
                    {testState === 'testing'
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <FlaskConical className="w-3.5 h-3.5" />}
                    Test
                  </button>
                </div>
                {testState !== 'idle' && testState !== 'testing' && (
                  <div className={cn(
                    'flex items-start gap-2 text-xs px-3 py-2 rounded-lg border',
                    testState === 'ok' ? 'text-gain bg-gain/5 border-gain/20' : 'text-loss bg-loss/5 border-loss/20',
                  )}>
                    {testState === 'ok'
                      ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    {testMsg}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-ink-secondary flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5 text-ink-muted" />
                  Working Copy Path
                  <span className="ml-auto text-[10px] text-ink-disabled font-normal">writable</span>
                </label>
                <input className="input font-mono text-xs" value={workingPath}
                  onChange={e => setWorkingPath(e.target.value)}
                  placeholder="/app/uploads/investment_tracking.xlsx" spellCheck={false} />
              </div>
            </div>
          )}

          {mode === 'db' && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-brand-500/8 border border-brand-500/20 text-brand-400 text-xs">
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span>Database mode. Manage positions in </span>
              <Link href="/settings/portfolio-db" className="font-medium underline underline-offset-2 flex items-center gap-1">
                Portfolio Manager <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          )}

          <button type="submit" disabled={saving}
            className="btn-primary flex items-center gap-2 px-4 py-1.5 text-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Portfolio
          </button>
        </form>
      )}
    </div>
  )
}

function PortfolioManagementSection() {
  const queryClient = useQueryClient()
  const { data: portfolios = [], isLoading } = useQuery({
    queryKey: ['portfolios'],
    queryFn: portfolioService.list,
  })

  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    queryClient.invalidateQueries({ queryKey: ['portfolio-mode'] })
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await portfolioService.create({ name: newName.trim() })
      setNewName('')
      invalidate()
      toast.success(`Portfolio "${newName.trim()}" created`)
    } catch {
      toast.error('Failed to create portfolio')
    } finally { setCreating(false) }
  }

  const handleUpdate = async (id: string, data: PortfolioUpdate) => {
    await portfolioService.update(id, data)
    invalidate()
  }

  const handleDelete = async (id: string) => {
    await portfolioService.delete(id)
    invalidate()
  }

  const handleSetDefault = async (id: string) => {
    await portfolioService.setDefault(id)
    invalidate()
  }

  return (
    <Section title="Portfolios" icon={Wallet}>
      <p className="text-xs text-ink-muted -mt-3">
        Manage your portfolios. Each portfolio has its own data source and Excel paths.
        Set one as default to use across all features.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading portfolios…
        </div>
      ) : (
        <div className="space-y-3">
          {portfolios.map(p => (
            <PortfolioCard
              key={p.id}
              portfolio={p}
              canDelete={portfolios.length > 1 && !p.is_default}
              onSetDefault={handleSetDefault}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}

          {/* Add new portfolio */}
          <div className="flex gap-2 pt-1">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="New portfolio name…"
              className="input flex-1 text-sm py-1.5" />
            <button onClick={handleCreate} disabled={!newName.trim() || creating}
              className="btn-primary flex items-center gap-1.5 px-4 py-1.5 text-sm disabled:opacity-40">
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add Portfolio
            </button>
          </div>
        </div>
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

// ── Email Digest Section ──────────────────────────────────────────────────────

function EmailDigestSection() {
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery<EmailDigestSettings>({
    queryKey: ['email-digest-settings'],
    queryFn: emailDigestService.getSettings,
  })

  const [enabled,       setEnabled]       = useState(false)
  const [recipient,     setRecipient]     = useState('')
  const [scheduleTime,  setScheduleTime]  = useState('17:30')
  const [saving,        setSaving]        = useState(false)
  const [sending,       setSending]       = useState(false)
  const [sendResult,    setSendResult]    = useState<string | null>(null)
  const [sendSuccess,   setSendSuccess]   = useState(false)

  // Sync local form state when query data arrives
  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled)
      setRecipient(settings.recipient)
      setScheduleTime(settings.schedule_time)
    }
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    try {
      await emailDigestService.updateSettings({
        enabled,
        recipient: recipient.trim(),
        schedule_time: scheduleTime,
      })
      await queryClient.invalidateQueries({ queryKey: ['email-digest-settings'] })
      toast.success('Email digest settings saved')
    } catch {
      toast.error('Failed to save email digest settings')
    } finally {
      setSaving(false)
    }
  }

  const handleSendNow = async () => {
    setSending(true)
    setSendResult(null)
    try {
      const result = await emailDigestService.sendNow()
      if (result.success) {
        const sentAt = result.sent_at ? new Date(result.sent_at).toLocaleTimeString() : ''
        setSendResult(sentAt ? `Sent at ${sentAt}` : 'Sent successfully')
        setSendSuccess(true)
        toast.success('Email digest sent')
      } else {
        setSendResult(result.error ?? 'Send failed')
        setSendSuccess(false)
        toast.error(result.error ?? 'Failed to send email digest')
      }
    } catch {
      setSendResult('Could not reach server')
      setSendSuccess(false)
      toast.error('Failed to send email digest')
    } finally {
      setSending(false)
    }
  }

  return (
    <Section title="Email Digest" icon={Mail}>
      <p className="text-xs text-ink-muted -mt-3">
        Receive a daily summary of your portfolio performance and action plan directly by email.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading settings…
        </div>
      ) : (
        <div className="space-y-5">
          {/* Enable / disable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-ink-secondary">Enable daily digest</p>
              <p className="text-xs text-ink-muted mt-0.5">Send an email summary every day at the configured time</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Enable daily digest"
              onClick={() => setEnabled(v => !v)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
                enabled ? 'bg-brand-500' : 'bg-surface-elevated',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out',
                  enabled ? 'translate-x-5' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>

          {/* Recipient email */}
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5" htmlFor="digest-recipient">
              Recipient email
            </label>
            <input
              id="digest-recipient"
              type="email"
              className="input"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="you@example.com"
            />
            <p className="text-xs text-ink-disabled mt-1">The digest will be delivered to this address.</p>
          </div>

          {/* Send time */}
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5" htmlFor="digest-time">
              Daily send time (Bangkok time)
            </label>
            <input
              id="digest-time"
              type="time"
              className="input w-36"
              value={scheduleTime}
              onChange={e => setScheduleTime(e.target.value)}
            />
            <p className="text-xs text-ink-muted mt-1">Email is sent once per day at this time (Asia/Bangkok, UTC+7).</p>
          </div>

          {/* Send result feedback */}
          {sendResult && (
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs',
              sendSuccess
                ? 'bg-gain/5 border-gain/20 text-gain'
                : 'bg-loss/5 border-loss/20 text-loss',
            )}>
              {sendSuccess
                ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
              {sendResult}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Settings
            </button>
            <button
              type="button"
              onClick={handleSendNow}
              disabled={sending}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-border text-ink-secondary hover:text-ink-primary hover:border-brand-500/40 transition-colors disabled:opacity-40"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send Now
            </button>
          </div>
        </div>
      )}
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
  onSave: (id: string, name: string, symbols: string[], market: ScanMarket, is_dr: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  isFirst: boolean
  isLast: boolean
}) {
  const [open,    setOpen]    = useState(false)
  const [name,    setName]    = useState(list.name)
  const [market,  setMarket]  = useState<ScanMarket>(list.market)
  const [isDr,    setIsDr]    = useState(list.is_dr)
  const [text,    setText]    = useState(list.symbols.join('\n'))
  const [saving,  setSaving]  = useState(false)
  const [deleting,setDeleting]= useState(false)
  const [syncing, setSyncing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const symbols = text.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean)

  const syncFromPortfolio = async () => {
    setSyncing(true)
    try {
      const positions = await portfolioDbService.getPositions('active')
      const portfolioSymbols = [...new Set(positions.map(p => p.symbol.toUpperCase()))]
      const currentSet = new Set(symbols)
      const newSymbols = portfolioSymbols.filter(s => !currentSet.has(s))
      if (newSymbols.length === 0) {
        toast.success('No new symbols — portfolio is already in this list')
        return
      }
      const merged = [...symbols, ...newSymbols]
      setText(merged.join('\n'))
      await onSave(list.id, name.trim() || list.name, merged, market, isDr)
      toast.success(`Added ${newSymbols.length} new symbol${newSymbols.length !== 1 ? 's' : ''} from portfolio`)
    } catch {
      toast.error('Failed to sync from portfolio')
    } finally { setSyncing(false) }
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(list.id, name.trim() || list.name, symbols, market, isDr)
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
          onBlur={() => name !== list.name && onSave(list.id, name.trim() || list.name, list.symbols, market, isDr).catch(() => {})} />
        <select value={market} onChange={e => {
            const m = e.target.value as ScanMarket
            setMarket(m)
            onSave(list.id, name.trim() || list.name, list.symbols, m, isDr).catch(() => {})
          }}
          className="shrink-0 bg-surface-elevated border border-border/50 rounded px-1.5 py-0.5 text-[10px] text-ink-secondary focus:outline-none focus:border-brand-500/50">
          {SCAN_MARKETS.map(m => (
            <option key={m.value} value={m.value} title={m.desc}>{m.label}</option>
          ))}
        </select>
        <button
          onClick={() => {
            const next = !isDr
            setIsDr(next)
            onSave(list.id, name.trim() || list.name, list.symbols, market, next).catch(() => {})
          }}
          title="DR list — shows DR SET ticker and price estimates in weekly scan"
          className={cn(
            'shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded border transition-colors',
            isDr
              ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-400'
              : 'border-border/50 text-ink-disabled hover:text-ink-muted',
          )}>
          DR
        </button>
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
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={syncFromPortfolio} disabled={syncing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-brand-500/40 bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors disabled:opacity-40">
              {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Sync from Portfolio
            </button>
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

  const handleSave = async (id: string, name: string, symbols: string[], market: ScanMarket, is_dr: boolean) => {
    await weeklyScanService.updateSymbolList(id, { name, symbols, market, is_dr })
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
        <h1 className="text-2xl font-bold text-ink-primary">My Profile</h1>
        <p className="text-ink-muted text-sm mt-0.5">Manage your profile, security, and personal preferences</p>
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

      {/* Multi-portfolio management (data source + Excel paths per portfolio) */}
      <PortfolioManagementSection />

      {/* Email Digest */}
      <EmailDigestSection />

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
