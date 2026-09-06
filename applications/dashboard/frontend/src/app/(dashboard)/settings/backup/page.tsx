'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  HardDriveDownload, HardDriveUpload, Trash2, Download, RefreshCw,
  CheckCircle2, AlertTriangle, Loader2, FileArchive, Upload, Table2,
  ChevronDown, ChevronUp, Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/services/api'
import { format } from 'date-fns'
import { RestoreModal, type RestoreTarget } from './RestoreModal'

// ── Types ──────────────────────────────────────────────────────────────────────

interface BackupMeta {
  filename: string
  size_kb: number
  created_at: string
}

/** One row of `GET /backup/tables` — describes coverage + restore eligibility. */
export interface BackupTableInfo {
  name: string
  row_count: number
  owner_service: 'backend' | 'tracking-backend'
  restorable: boolean
  in_conflict_check: boolean
  note?: string
}

/** Response of `GET /backup/tables` — the authoritative list of what a backup covers. */
export interface BackupTablesData {
  database: string
  generated_at: string
  total_tables: number
  insert_order: string[]
  tables: BackupTableInfo[]
}

export interface BackupResult {
  filename?: string
  created_at?: string
  size_kb?: number
  total_rows?: number
  row_counts?: Record<string, number>
  restored?: Record<string, number>
  errors?: string[]
  source_created_at?: string
  // ── Extended restore/backup diagnostics (Phase 3 backend) ──
  checksum_verification?: Record<string, 'ok' | 'mismatch' | 'skipped'>
  schema_version_drift?: Record<string, { file: string; live: string; match: boolean }>
  legacy_backup?: boolean
  uncovered_tables?: string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try { return format(new Date(iso), 'dd MMM yyyy HH:mm:ss') } catch { return iso }
}

function fmtSize(kb: number) {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US')
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function OwnerBadge({ owner }: { owner: string }) {
  const isTracking = owner === 'tracking-backend'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border shrink-0',
        isTracking
          ? 'text-amber-400 border-amber-500/30 bg-amber-500/8'
          : 'text-ink-muted border-border/50 bg-surface-elevated',
      )}
    >
      {owner}
    </span>
  )
}

function ResultBox({ result }: { result: BackupResult }) {
  const hasErrors = result.errors && result.errors.length > 0
  const drift = result.schema_version_drift
  const hasDrift = drift && Object.values(drift).some(d => !d.match)

  return (
    <div className={cn('rounded-xl border p-4 text-xs space-y-2 mt-3',
      hasErrors ? 'border-loss/30 bg-loss/5' : 'border-gain/30 bg-gain/5')}>
      <div className="flex items-center gap-2 font-semibold">
        {hasErrors ? <AlertTriangle className="w-4 h-4 text-loss" /> : <CheckCircle2 className="w-4 h-4 text-gain" />}
        <span className={hasErrors ? 'text-loss' : 'text-gain'}>
          {result.filename ? `Backup created: ${result.filename}` : `Restored ${result.total_rows} rows`}
        </span>
      </div>

      {result.legacy_backup && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 space-y-1">
          <p className="font-semibold text-amber-400">Legacy backup format (v1.1)</p>
          {result.uncovered_tables && result.uncovered_tables.length > 0 && (
            <p className="text-ink-muted">
              Tables not present in this backup: {result.uncovered_tables.join(', ')}
            </p>
          )}
        </div>
      )}

      {result.row_counts && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-ink-muted pl-6">
          {Object.entries(result.row_counts).map(([t, n]) => (
            <span key={t}>{t}: <strong className="text-ink-secondary">{n}</strong></span>
          ))}
        </div>
      )}

      {result.restored && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-ink-muted pl-6">
          {Object.entries(result.restored).map(([t, n]) => (
            <span key={t} className={n < 0 ? 'text-loss' : ''}>
              {t}: <strong>{n < 0 ? 'ERROR' : n}</strong>
            </span>
          ))}
        </div>
      )}

      {result.checksum_verification && (
        <div className="pl-6 space-y-1">
          <p className="font-semibold text-ink-secondary">Checksum verification</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(result.checksum_verification).map(([t, status]) => (
              <span
                key={t}
                className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border',
                  status === 'ok' && 'text-gain border-gain/30 bg-gain/5',
                  status === 'mismatch' && 'text-loss border-loss/30 bg-loss/5',
                  status === 'skipped' && 'text-ink-muted border-border/50 bg-surface-elevated',
                )}
              >
                {t}: {status}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasDrift && (
        <p className="pl-6 text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Schema version drift detected:{' '}
            {Object.entries(drift!)
              .filter(([, d]) => !d.match)
              .map(([t, d]) => `${t} (file ${d.file} → live ${d.live})`)
              .join(', ')}
          </span>
        </p>
      )}

      {hasErrors && result.errors!.map((e, i) => (
        <p key={i} className="text-loss pl-6 font-mono">{e}</p>
      ))}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function BackupPage() {
  const qc = useQueryClient()
  const restoreRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [result, setResult] = useState<BackupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPsv, setShowPsv] = useState(false)
  const [showCoverage, setShowCoverage] = useState(false)
  const [selectedTable, setSelectedTable] = useState('')
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const [psvReplaceConfirm, setPsvReplaceConfirm] = useState('')
  const [importing, setImporting] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null)

  const { data: backups = [], isLoading } = useQuery<BackupMeta[]>({
    queryKey: ['backup-list'],
    queryFn: async () => { const { data } = await apiClient.get('/backup/list'); return data },
    staleTime: 30_000,
  })

  const { data: tablesData } = useQuery<BackupTablesData>({
    queryKey: ['backup-tables'],
    queryFn: () => apiClient.get('/backup/tables').then(r => r.data),
    staleTime: 30_000,
  })

  // The PSV selector must not offer schema-version tables (alembic_version,
  // ft_alembic_version) — they are neither restorable nor part of the conflict
  // check, and the backend rejects PSV import/export against them. The Coverage
  // card below still shows them (with their note); only this list is filtered.
  const tableNames = (tablesData?.tables ?? [])
    .filter(t => t.restorable !== false && t.in_conflict_check !== false)
    .map(t => t.name)

  // Default the PSV table selector to the first table, but keep the admin's
  // current selection stable across a refetch as long as it still exists.
  useEffect(() => {
    if (tableNames.length === 0) return
    setSelectedTable(prev => (prev && tableNames.includes(prev) ? prev : tableNames[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesData])

  // Populated tables the backend would refuse to overwrite in safe mode — the
  // wipe preview shown for a replace-all restore.
  const wipeTables = (tablesData?.tables ?? [])
    .filter(t => t.in_conflict_check && t.row_count > 0)
    .map(t => ({ name: t.name, row_count: t.row_count }))

  const psvReplaceToken = `REPLACE ${selectedTable}`
  const canImport =
    !importing && (importMode === 'append' || psvReplaceConfirm === psvReplaceToken)

  const setOk = (r: BackupResult) => { setResult(r); setError(null) }
  const setErr = (msg: string) => { setError(msg); setResult(null) }

  // ── Create backup ────────────────────────────────────────────────────────────

  const createBackup = async () => {
    setCreating(true); setResult(null); setError(null)
    try {
      const { data } = await apiClient.post('/backup/create')
      setOk(data)
      qc.invalidateQueries({ queryKey: ['backup-list'] })
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? 'Backup failed')
    } finally { setCreating(false) }
  }

  // ── Download backup ──────────────────────────────────────────────────────────

  const downloadBackup = (filename: string) => {
    const token = (apiClient.defaults.headers as any).Authorization ?? ''
    const a = document.createElement('a')
    // Use fetch so we can include auth header
    fetch(`/api/proxy/api/v1/backup/download/${filename}`, {
      headers: { Authorization: token },
    }).then(r => r.blob()).then(blob => {
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
    })
  }

  // ── Delete backup ────────────────────────────────────────────────────────────

  const deleteBackup = async (filename: string) => {
    if (!confirm(`Delete backup ${filename}?`)) return
    setDeleting(filename)
    try {
      await apiClient.delete(`/backup/${filename}`)
      qc.invalidateQueries({ queryKey: ['backup-list'] })
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? 'Delete failed')
    } finally { setDeleting(null) }
  }

  // ── Restore (stored file or upload) — routed through RestoreModal ─────────────

  const handleRestoreUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setResult(null); setError(null)
    setRestoreTarget({ kind: 'upload', file })
  }

  const openStoredRestore = (filename: string) => {
    setResult(null); setError(null)
    setRestoreTarget({ kind: 'file', filename })
  }

  const handleRestoreSuccess = (data: BackupResult) => {
    setOk(data)
    setRestoreTarget(null)
    qc.invalidateQueries({ queryKey: ['backup-list'] })
    qc.invalidateQueries({ queryKey: ['backup-tables'] })
  }

  // ── PSV export ───────────────────────────────────────────────────────────────

  const exportPsv = async () => {
    if (!selectedTable) return
    const token = (apiClient.defaults.headers as any).Authorization ?? ''
    const r = await fetch(`/api/proxy/api/v1/backup/export-table/${selectedTable}`, {
      headers: { Authorization: token },
    })
    const blob = await r.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${selectedTable}_${new Date().toISOString().slice(0, 10)}.psv`
    a.click()
  }

  // ── PSV import ───────────────────────────────────────────────────────────────

  const handlePsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Guard: destructive replace requires the exact `REPLACE <table>` phrase.
    if (importMode === 'replace' && psvReplaceConfirm !== psvReplaceToken) {
      e.target.value = ''
      return
    }
    setImporting(true); setResult(null); setError(null)
    try {
      const form = new FormData(); form.append('file', file)
      let url = `/backup/import-table/${selectedTable}?mode=${importMode}`
      if (importMode === 'replace') {
        url += `&confirm=${encodeURIComponent(psvReplaceToken)}`
      }
      const { data } = await apiClient.post(url, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setOk({ total_rows: data.imported, row_counts: { [selectedTable]: data.imported } })
      qc.invalidateQueries({ queryKey: ['backup-list'] })
      qc.invalidateQueries({ queryKey: ['backup-tables'] })
    } catch (err: any) {
      setErr(err?.response?.data?.detail ?? 'Import failed')
    } finally { setImporting(false); e.target.value = '' }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <HardDriveDownload className="w-5 h-5 text-brand-400" />
        <div>
          <h1 className="text-lg font-bold text-ink-primary">Backup &amp; Restore</h1>
          <p className="text-xs text-ink-muted">Full database backup, restore, and per-table PSV export/import</p>
        </div>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-400 border border-amber-500/30 bg-amber-500/8 rounded px-2 py-1">
          <Shield className="w-3 h-3" /> Admin only
        </span>
      </div>

      {/* Feedback */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-loss/30 bg-loss/8 text-xs text-loss">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {result && <ResultBox result={result} />}

      {/* ── Coverage ── */}
      {tablesData && (
        <div className="card p-5 space-y-3">
          <button
            onClick={() => setShowCoverage(v => !v)}
            className="w-full flex items-center justify-between"
            aria-expanded={showCoverage}
          >
            <div className="text-left">
              <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
                <Table2 className="w-4 h-4 text-brand-400" />
                Covers {tablesData.total_tables} tables
              </h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Database <span className="font-mono">{tablesData.database}</span> · snapshot {fmtDate(tablesData.generated_at)}
              </p>
            </div>
            {showCoverage
              ? <ChevronUp className="w-4 h-4 text-ink-muted" />
              : <ChevronDown className="w-4 h-4 text-ink-muted" />}
          </button>

          {showCoverage && (
            <ul className="rounded-xl border border-border/40 divide-y divide-border/30 text-xs">
              {tablesData.tables.map(t => (
                <li key={t.name} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-ink-primary flex-1 min-w-0 truncate">{t.name}</span>
                  <span className="text-ink-muted tabular-nums shrink-0">{fmtNum(t.row_count)} rows</span>
                  <OwnerBadge owner={t.owner_service} />
                  {!t.restorable && t.note && (
                    <span className="basis-full text-ink-disabled italic">{t.note}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Full backup ── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
              <FileArchive className="w-4 h-4 text-brand-400" /> Full Database Backup
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Exports all tables as compressed JSON — includes users, plans, scans, notes
            </p>
          </div>
          <button
            onClick={createBackup}
            disabled={creating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HardDriveDownload className="w-3.5 h-3.5" />}
            {creating ? 'Creating…' : 'Create Backup'}
          </button>
        </div>

        {/* Stored backups list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Stored Backups</p>
            <button onClick={() => qc.invalidateQueries({ queryKey: ['backup-list'] })} className="btn-icon">
              <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            </button>
          </div>

          {isLoading ? (
            <div className="skeleton h-12 rounded-lg" />
          ) : backups.length === 0 ? (
            <div className="text-center py-6 text-ink-muted text-xs">
              No backups yet — click <strong>Create Backup</strong> to make one
            </div>
          ) : (
            <div className="rounded-xl border border-border/40 overflow-hidden">
              {backups.map((b, i) => (
                <div key={b.filename} className={cn(
                  'flex items-center gap-3 px-4 py-3 text-xs',
                  i !== backups.length - 1 && 'border-b border-border/30'
                )}>
                  <FileArchive className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-ink-primary truncate">{b.filename}</p>
                    <p className="text-ink-disabled">{fmtDate(b.created_at)} · {fmtSize(b.size_kb)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => downloadBackup(b.filename)} title="Download"
                      className="btn-icon text-ink-muted hover:text-brand-400">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => openStoredRestore(b.filename)}
                      disabled={!!restoreTarget}
                      title="Restore from this backup"
                      className="btn-icon text-ink-muted hover:text-amber-400 disabled:opacity-40"
                    >
                      <HardDriveUpload className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteBackup(b.filename)} disabled={deleting === b.filename}
                      title="Delete" className="btn-icon text-ink-muted hover:text-loss">
                      {deleting === b.filename
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Restore from upload */}
        <div className="pt-2 border-t border-border/40">
          <p className="text-xs text-ink-muted mb-2">Or restore from a local backup file:</p>
          <input ref={restoreRef} type="file" accept=".json,.json.gz,.gz" className="hidden"
            onChange={handleRestoreUpload} />
          <button
            onClick={() => restoreRef.current?.click()}
            disabled={!!restoreTarget}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/8 text-amber-400 hover:bg-amber-500/15 text-xs font-semibold transition-colors disabled:opacity-40"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload &amp; Restore
          </button>
        </div>
      </div>

      {/* ── PSV export / import ── */}
      <div className="card p-5 space-y-4">
        <button onClick={() => setShowPsv(v => !v)} className="w-full flex items-center justify-between">
          <div className="text-left">
            <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
              <Table2 className="w-4 h-4 text-amber-400" /> Per-Table Export / Import
              <span className="text-[10px] font-normal text-ink-muted">(pipe-separated)</span>
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Export or import individual tables as .psv files (columns separated by |)
            </p>
          </div>
          {showPsv ? <ChevronUp className="w-4 h-4 text-ink-muted" /> : <ChevronDown className="w-4 h-4 text-ink-muted" />}
        </button>

        {showPsv && (
          <div className="space-y-4 pt-1">
            {/* Table selector */}
            <div className="space-y-1.5">
              <label htmlFor="psv-table-select" className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
                Table
              </label>
              <select
                id="psv-table-select"
                value={selectedTable}
                onChange={e => setSelectedTable(e.target.value)}
                className="input w-full text-xs py-1.5"
              >
                {tableNames.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Export */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink-secondary">Export</p>
                <p className="text-[11px] text-ink-muted">Download the selected table as a .psv file</p>
                <button onClick={exportPsv} disabled={!selectedTable}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-brand-500/40 bg-brand-500/8 text-brand-400 hover:bg-brand-500/15 text-xs font-semibold transition-colors disabled:opacity-40">
                  <Download className="w-3.5 h-3.5" /> Export {selectedTable}
                </button>
              </div>

              {/* Import */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink-secondary">Import</p>
                <div className="flex items-center gap-2">
                  <label htmlFor="psv-import-mode" className="text-[11px] text-ink-muted">Mode:</label>
                  <select id="psv-import-mode" value={importMode} onChange={e => setImportMode(e.target.value as any)}
                    className="input text-[11px] py-0.5 px-2">
                    <option value="append">Append (skip duplicates)</option>
                    <option value="replace">Replace (truncate first)</option>
                  </select>
                </div>

                {importMode === 'replace' && (
                  <div className="space-y-1">
                    <label htmlFor="psv-replace-confirm" className="block text-[11px] text-loss">
                      Type <span className="font-mono">REPLACE {selectedTable}</span> to confirm truncate
                    </label>
                    <input
                      id="psv-replace-confirm"
                      value={psvReplaceConfirm}
                      onChange={e => setPsvReplaceConfirm(e.target.value)}
                      autoComplete="off"
                      placeholder={`REPLACE ${selectedTable}`}
                      className="input w-full text-[11px] py-1"
                    />
                  </div>
                )}

                <input ref={importRef} type="file" accept=".psv,.txt,.csv" className="hidden"
                  onChange={handlePsvImport} />
                <button onClick={() => importRef.current?.click()} disabled={!canImport}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/8 text-amber-400 hover:bg-amber-500/15 text-xs font-semibold transition-colors disabled:opacity-40">
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Import into {selectedTable}
                </button>
              </div>
            </div>

            {/* PSV format note */}
            <div className="rounded-lg bg-surface-elevated border border-border/40 p-3 text-[11px] text-ink-muted space-y-1">
              <p className="font-semibold text-ink-secondary">PSV format</p>
              <p>Header row | column names separated by <code className="text-brand-300">|</code></p>
              <p>Data rows | values separated by <code className="text-brand-300">|</code> · empty = NULL · JSON values preserved</p>
              <p>Literal <code className="text-brand-300">|</code> in values is escaped as <code className="text-brand-300">\|</code></p>
            </div>
          </div>
        )}
      </div>

      {restoreTarget && (
        <RestoreModal
          target={restoreTarget}
          wipeTables={wipeTables}
          onClose={() => setRestoreTarget(null)}
          onSuccess={handleRestoreSuccess}
        />
      )}

    </div>
  )
}
