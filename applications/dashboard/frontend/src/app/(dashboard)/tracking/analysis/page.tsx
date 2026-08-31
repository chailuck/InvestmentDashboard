'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Loader2, AlertCircle, Info } from 'lucide-react'
import Link from 'next/link'
import { trackingService, type DashboardBalanceGridOut } from '@/services/tracking'
import {
  buildScopedGrid,
  buildStatRow,
  defaultGroupBy,
  defaultViewState,
  deriveChartModel,
  drillDepth,
  findCategory,
  findSubCategory,
  lensLabel,
  locateItem,
  queryToViewState,
  resolveComparison,
  viewStateToQuery,
} from '@/lib/tracking-analysis'
import {
  analysisCsvFilename,
  buildAnalysisCsv,
  buildComparisonCsv,
  comparisonCsvFilename,
  type AnalysisCsvInput,
  type ExportBucketRow,
} from '@/lib/tracking-analysis-export'
import type { DrillDepth, DrillPath, PeriodRef, ViewState } from './types'
import { AnalysisControlBar } from './components/AnalysisControlBar'
import { DrillBreadcrumb, type Crumb } from './components/DrillBreadcrumb'
import { StatRow } from './components/StatRow'
import { ScopedDashboardSection } from './components/ScopedDashboardSection'
import { ChartCard } from './components/ChartCard'
import { TrendChart } from './components/TrendChart'
import { CompositionChart } from './components/CompositionChart'
import { CompositionSnapshot } from './components/CompositionSnapshot'
import { DeltaTrendChart } from './components/DeltaTrendChart'
import { ComparisonPanel, type ComparisonPanelModel } from './components/ComparisonPanel'
import { ExportButton, type CsvFile } from './components/ExportButton'

const GROUP_BY_LABEL: Record<ViewState['groupBy'], string> = {
  category: 'Category', subCategory: 'Sub-category', item: 'Item', itemType: 'Item type',
}

function AnalysisPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [selectedSetId, setSelectedSetId] = useState('')
  const [viewState, setViewState] = useState<ViewState>(() =>
    queryToViewState(new URLSearchParams(searchParams?.toString() ?? ''), ''),
  )

  const { data: sets = [], isLoading: setsLoading, isError: setsError } = useQuery({
    queryKey: ['tracking-sets'],
    queryFn: trackingService.listSets,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!selectedSetId && sets.length > 0) setSelectedSetId(sets[0].id)
  }, [sets, selectedSetId])

  useEffect(() => {
    if (selectedSetId && viewState.trackingSetId !== selectedSetId) {
      setViewState(vs => ({ ...vs, trackingSetId: selectedSetId }))
    }
  }, [selectedSetId, viewState.trackingSetId])

  const { data: grid, isLoading: gridLoading, isError: gridError } = useQuery<DashboardBalanceGridOut>({
    queryKey: ['tracking-analysis-balance-grid', selectedSetId],
    queryFn: () => trackingService.getBalanceGrid(selectedSetId),
    enabled: !!selectedSetId,
    staleTime: 10_000,
  })

  // Serialise ViewState → URL query string (NFR-3; the only "saved view").
  useEffect(() => {
    if (!pathname) return
    const qs = viewStateToQuery(viewState).toString()
    try {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    } catch {
      /* router unavailable (e.g. in tests) — URL sync is best-effort */
    }
  }, [viewState, pathname, router])

  // Validate a URL-hydrated drill path against the fetched grid — an id that
  // no longer resolves (renamed / deleted / cross-set link) falls back to the
  // default landing view rather than stranding the user on an empty state.
  useEffect(() => {
    if (!grid) return
    setViewState(vs => {
      const d = vs.drill
      const bad =
        (d.categoryId && !findCategory(grid, d.categoryId)) ||
        (d.subCategoryId && !findSubCategory(grid, d.categoryId, d.subCategoryId)) ||
        (d.itemId && !locateItem(grid, d.itemId))
      if (!bad) return vs
      return {
        ...vs,
        drill: { lens: vs.lens },
        groupBy: defaultGroupBy(0),
        snapshotPeriod: undefined,
        scopedDashboardCollapsed: undefined,
      }
    })
  }, [grid])

  const patch = useCallback((p: Partial<ViewState>) => setViewState(vs => ({ ...vs, ...p })), [])

  // AC-9 — a granularity change clears an active comparison; surface a
  // transient notice near the control bar so the change is not silent.
  const [transientNotice, setTransientNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!transientNotice) return
    const t = setTimeout(() => setTransientNotice(null), 6000)
    return () => clearTimeout(t)
  }, [transientNotice])

  const handleControlChange = useCallback(
    (p: Partial<ViewState>) => {
      if (p.granularity && p.granularity !== viewState.granularity && viewState.comparison.mode !== 'off') {
        setTransientNotice('Comparison cleared due to granularity change')
      }
      patch(p)
    },
    [patch, viewState.granularity, viewState.comparison.mode],
  )

  // ── Derivations ──────────────────────────────────────────────────────────
  const chartModel = useMemo(() => (grid ? deriveChartModel(grid, viewState) : null), [grid, viewState])
  const scoped = useMemo(() => (grid ? buildScopedGrid(grid, viewState) : null), [grid, viewState])
  const statRow = useMemo(
    () => (chartModel && chartModel.empty === null ? buildStatRow(chartModel.axis, chartModel.aggregate.balance) : null),
    [chartModel],
  )

  const depth = drillDepth(viewState.drill)

  const crumbs = useMemo<Crumb[]>(() => {
    const list: Crumb[] = [{ depth: 0, label: lensLabel(viewState.lens) }]
    if (!grid) return list
    if (viewState.drill.categoryId) {
      list.push({ depth: 1, label: findCategory(grid, viewState.drill.categoryId)?.name ?? 'Category' })
    }
    if (viewState.drill.subCategoryId) {
      list.push({ depth: 2, label: findSubCategory(grid, viewState.drill.categoryId, viewState.drill.subCategoryId)?.name ?? 'Sub-category' })
    }
    if (viewState.drill.itemId) {
      list.push({ depth: 3, label: locateItem(grid, viewState.drill.itemId)?.item.name ?? 'Item' })
    }
    return list
  }, [grid, viewState.lens, viewState.drill])

  const drillPathLabel = crumbs.map(c => c.label).join(' › ')

  const populatedPeriods = useMemo<{ ref: PeriodRef; label: string }[]>(() => {
    if (!chartModel) return []
    return chartModel.axis
      .map((a, i) => ({ a, i }))
      .filter(({ i }) => chartModel.aggregate.balance[i] !== null)
      .map(({ a }) => ({
        ref: (a.quarter === null ? { kind: 'year', year: a.year } : { kind: 'quarter', year: a.year, quarter: a.quarter }) as PeriodRef,
        label: a.label,
      }))
  }, [chartModel])

  // ── Drill navigation ─────────────────────────────────────────────────────
  const goToDepth = useCallback((target: DrillDepth) => {
    setViewState(vs => {
      const d: DrillPath = { lens: vs.lens }
      if (target >= 1) d.categoryId = vs.drill.categoryId
      if (target >= 2) d.subCategoryId = vs.drill.subCategoryId
      if (target >= 3) d.itemId = vs.drill.itemId
      return { ...vs, drill: d, groupBy: defaultGroupBy(target), snapshotPeriod: undefined, scopedDashboardCollapsed: undefined }
    })
  }, [])

  const drillInto = useCallback((id: string) => {
    setViewState(vs => {
      const cur = drillDepth(vs.drill)
      const d: DrillPath = { ...vs.drill }
      let next: DrillDepth = cur
      if (cur === 0) { d.categoryId = id; next = 1 }
      else if (cur === 1) { d.subCategoryId = id; next = 2 }
      else if (cur === 2) { d.itemId = id; next = 3 }
      else return vs
      return { ...vs, drill: d, groupBy: defaultGroupBy(next), snapshotPeriod: undefined, scopedDashboardCollapsed: undefined }
    })
  }, [])

  // ── Snapshot period index ────────────────────────────────────────────────
  const snapshotIndex = useMemo(() => {
    if (!chartModel || chartModel.axis.length === 0) return 0
    const ref = viewState.snapshotPeriod
    if (ref) {
      const found = chartModel.axis.findIndex(a =>
        ref.kind === 'year' ? a.quarter === null && a.year === ref.year : a.year === ref.year && a.quarter === ref.quarter,
      )
      if (found >= 0) return found
    }
    for (let i = chartModel.axis.length - 1; i >= 0; i--) if (chartModel.aggregate.balance[i] !== null) return i
    return chartModel.axis.length - 1
  }, [chartModel, viewState.snapshotPeriod])

  const setSnapshotIndex = useCallback((idx: number) => {
    setViewState(vs => {
      if (!chartModel || !chartModel.axis[idx]) return vs
      const a = chartModel.axis[idx]
      return {
        ...vs,
        snapshotPeriod: a.quarter === null ? { kind: 'year', year: a.year } : { kind: 'quarter', year: a.year, quarter: a.quarter },
      }
    })
  }, [chartModel])

  // ── Comparison model ─────────────────────────────────────────────────────
  const comparisonModel = useMemo<ComparisonPanelModel | null>(() => {
    if (!chartModel || viewState.comparison.mode === 'off') return null
    const resolved = resolveComparison(viewState.comparison, chartModel.axis, chartModel.aggregate.balance)
    const groupByLabel = GROUP_BY_LABEL[viewState.groupBy].toLowerCase()
    const header = `${viewState.comparison.mode.toUpperCase()} · by ${groupByLabel}`
    if (!resolved.ok || !resolved.periodA || !resolved.periodB) {
      return { ok: false, note: resolved.note, headerLabel: header, periodALabel: '', periodBLabel: '', rows: [], total: emptyCmpRow() }
    }
    const idxOf = (ref: PeriodRef) =>
      chartModel.axis.findIndex(a =>
        ref.kind === 'year' ? a.quarter === null && a.year === ref.year : a.year === ref.year && a.quarter === ref.quarter,
      )
    const ia = idxOf(resolved.periodA)
    const ib = idxOf(resolved.periodB)
    const periodALabel = ia >= 0 ? chartModel.axis[ia].label : ''
    const periodBLabel = ib >= 0 ? chartModel.axis[ib].label : ''
    const mk = (name: string, a: number | null, b: number | null) => {
      const delta = a !== null && b !== null ? b - a : null
      const deltaPercent = delta !== null && a !== null && a > 0 ? (delta / a) * 100 : null
      return { name, valueA: a, valueB: b, delta, deltaPercent }
    }
    const rows = chartModel.buckets.map(bk => mk(bk.label, ia >= 0 ? bk.balance[ia] : null, ib >= 0 ? bk.balance[ib] : null))
    const total = mk(`${lensLabel(viewState.lens)} total`, ia >= 0 ? chartModel.aggregate.balance[ia] : null, ib >= 0 ? chartModel.aggregate.balance[ib] : null)
    return {
      ok: true,
      note: resolved.fallbackUsed ? resolved.note : null,
      headerLabel: `${header} · ${periodALabel} → ${periodBLabel}`,
      periodALabel,
      periodBLabel,
      rows,
      total,
    }
  }, [chartModel, viewState.comparison, viewState.groupBy, viewState.lens])

  // ── CSV export ───────────────────────────────────────────────────────────
  const buildCsvFiles = useCallback((): CsvFile[] => {
    if (!chartModel || !scoped) return []
    const generatedAt = new Date().toISOString()
    const setName = sets.find(s => s.id === selectedSetId)?.name ?? 'set'
    const ctx = {
      trackingSetName: setName,
      lensLabel: lensLabel(viewState.lens),
      drillPathLabel,
      groupByLabel: GROUP_BY_LABEL[viewState.groupBy],
      granularityLabel: viewState.granularity === 'yearly' ? 'Yearly' : 'Quarterly',
      measureLabel: viewState.measure,
      generatedAt,
      comparison:
        comparisonModel && comparisonModel.ok
          ? { modeLabel: viewState.comparison.mode.toUpperCase(), periodALabel: comparisonModel.periodALabel, periodBLabel: comparisonModel.periodBLabel }
          : null,
    }

    const periodCell = (bucketIdx: number | 'agg', i: number) => {
      const a = chartModel.axis[i]
      const series = bucketIdx === 'agg' ? chartModel.aggregate : chartModel.buckets[bucketIdx]
      return {
        label: a.label,
        year: a.year,
        quarter: a.quarter,
        asOfQuarter: a.asOfQuarter,
        balance: series.balance[i],
        deltaAmount: series.deltaAmount[i],
        deltaPercent: series.deltaPercent[i],
        sharePercent: bucketIdx === 'agg' ? null : chartModel.composition.sharePercent[bucketIdx]?.[i] ?? null,
        hasData: series.balance[i] !== null,
      }
    }

    const rows: ExportBucketRow[] = [
      ...chartModel.buckets.map((bk, bi) => ({
        bucketName: bk.label,
        bucketKind: bk.kind as ExportBucketRow['bucketKind'],
        drillPath: drillPathLabel,
        periods: chartModel.axis.map((_, i) => periodCell(bi, i)),
      })),
      {
        bucketName: `${lensLabel(viewState.lens)} total`,
        bucketKind: 'aggregate',
        drillPath: drillPathLabel,
        periods: chartModel.axis.map((_, i) => periodCell('agg', i)),
      },
    ]

    // Scoped Dashboard grid rows — only when the section is expanded (§4.8 / AC-SD-31..33).
    const scopedExpanded = (viewState.scopedDashboardCollapsed ?? scoped.depth === 0) === false && scoped.render
    if (scopedExpanded) {
      const kindMap: Record<string, ExportBucketRow['bucketKind'] | null> = {
        scopeTotal: 'scopeTotal', subCategorySubtotal: 'subCategoryTotal', item: 'item',
        splitProperty: null, splitNonProperty: null, exclusiveItem: null, lensStrip: null,
      }
      for (const r of scoped.rows) {
        const kind = kindMap[r.kind]
        if (!kind) continue
        rows.push({
          bucketName: r.label,
          bucketKind: kind,
          drillPath: `${drillPathLabel} :: scoped`,
          periods: scoped.axis.map((a, i) => ({
            label: `Q${a.quarter} ${a.year}`,
            year: a.year,
            quarter: a.quarter,
            asOfQuarter: null,
            balance: r.balance[i],
            deltaAmount: r.deltaAmount[i],
            deltaPercent: r.deltaPercent[i],
            sharePercent: null,
            hasData: r.hasData[i],
          })),
        })
      }
    }

    const input: AnalysisCsvInput = {
      ...ctx,
      rows,
      comparisonRows:
        comparisonModel && comparisonModel.ok
          ? [...comparisonModel.rows, comparisonModel.total].map(r => ({
              bucketName: r.name,
              periodALabel: comparisonModel.periodALabel,
              valueA: r.valueA,
              periodBLabel: comparisonModel.periodBLabel,
              valueB: r.valueB,
              deltaAmount: r.delta,
              deltaPercent: r.deltaPercent,
            }))
          : null,
    }

    const files: CsvFile[] = [
      { filename: analysisCsvFilename(input, viewState.lens, viewState.groupBy, viewState.granularity), content: buildAnalysisCsv(input) },
    ]
    if (input.comparisonRows) {
      files.push({
        filename: comparisonCsvFilename(input, viewState.lens, viewState.groupBy, viewState.granularity),
        content: buildComparisonCsv(input),
      })
    }
    return files
  }, [chartModel, scoped, sets, selectedSetId, viewState, drillPathLabel, comparisonModel])

  const subCaption = useMemo(() => {
    if (!scoped) return ''
    const scopeKindLabel =
      scoped.scopeKind === 'category' ? 'Category' : scoped.scopeKind === 'subCategory' ? 'Sub-category' : scoped.scopeKind === 'item' ? 'Item' : 'Set'
    const gran = viewState.granularity === 'yearly' ? 'Yearly' : 'Quarterly'
    return `${scopeKindLabel}: ${scoped.scopeLabel} · ${gran} · ${lensLabel(viewState.lens)}`
  }, [scoped, viewState.granularity, viewState.lens])

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-16">
      <header>
        <h1 className="text-lg font-semibold text-ink-primary">Financial Tracker · Analysis</h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Read-only exploration of your tracked net worth — trend, composition and period-over-period change. One API call per set; every control is client-side.
        </p>
      </header>

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <label htmlFor="analysis-set-select" className="text-xs font-medium text-ink-secondary shrink-0">Tracking Set</label>
        {setsLoading ? (
          <span className="flex items-center gap-2 text-ink-muted text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading sets…</span>
        ) : setsError ? (
          <span className="flex items-center gap-2 text-loss text-xs"><AlertCircle className="w-3.5 h-3.5" /> Failed to load tracking sets.</span>
        ) : sets.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No tracking sets yet — <Link href="/tracking/category" className="text-brand-400 hover:underline">create one</Link> to get started.
          </p>
        ) : (
          <select
            id="analysis-set-select"
            value={selectedSetId}
            onChange={e => setSelectedSetId(e.target.value)}
            className="input text-sm min-w-[220px]"
          >
            {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="ml-auto">
          <ExportButton getFiles={buildCsvFiles} disabled={!chartModel || chartModel.empty !== null} />
        </div>
      </div>

      {!selectedSetId ? (
        !setsLoading && sets.length === 0 ? (
          <div className="card py-12 text-center text-ink-muted text-sm">
            Create a tracking set on the <Link href="/tracking/category" className="text-brand-400 hover:underline">Category</Link> page before using Analysis.
          </div>
        ) : null
      ) : gridLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading balance grid…
        </div>
      ) : gridError || !grid ? (
        <div className="flex items-center justify-center py-16 gap-2 text-loss text-sm">
          <AlertCircle className="w-4 h-4" /> Tracking set not found, or the balance grid failed to load.
        </div>
      ) : grid.years.length === 0 ? (
        <div className="card py-12 text-center text-ink-muted text-sm">
          No quarterly data yet for this tracking set. Record a balance update with a quarter and year set from{' '}
          <Link href="/tracking/updates" className="text-brand-400 hover:underline">Updates</Link> to see it here.
        </div>
      ) : (
        <>
          <AnalysisControlBar viewState={viewState} populatedPeriods={populatedPeriods} onChange={handleControlChange} />

          {transientNotice && (
            <div role="status" className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-md px-3 py-1.5">
              {transientNotice}
            </div>
          )}

          <DrillBreadcrumb crumbs={crumbs} onNavigate={goToDepth} onUp={() => goToDepth(Math.max(0, depth - 1) as DrillDepth)} />

          {statRow ? <StatRow model={statRow} /> : <StatRow model={zeroStat()} cleared />}

          {chartModel && chartModel.empty !== null ? (
            <div className="card py-12 text-center text-ink-muted text-sm flex flex-col items-center gap-2">
              <Info className="w-5 h-5" />
              {chartModel.empty === 'noQualifyingItems'
                ? `No qualifying items for '${lensLabel(viewState.lens)}' at this level. Try another lens or step back up.`
                : chartModel.empty === 'leafEmpty'
                ? 'This item has no recorded balances yet — the most detailed level is shown.'
                : 'No quarterly data available.'}
            </div>
          ) : chartModel ? (
            <>
              <ChartCard
                title="Trend"
                subtitle={
                  depth === 3
                    ? 'Single item — the most detailed level; drill is disabled.'
                    : `${GROUP_BY_LABEL[viewState.groupBy]} series over time, with the ${depth === 0 ? 'lens' : 'scope'} total overlay.`
                }
              >
                <TrendChart
                  axis={chartModel.axis}
                  series={chartModel.buckets}
                  aggregate={chartModel.aggregate}
                  measure={viewState.measure}
                  onDrill={drillInto}
                />
              </ChartCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Composition over time" subtitle="Share of the scope total by bucket.">
                  <CompositionChart
                    axis={chartModel.axis}
                    buckets={chartModel.buckets}
                    composition={chartModel.composition}
                    onDrill={drillInto}
                  />
                </ChartCard>
                <ChartCard title="Breakdown at a period" subtitle="Ranked buckets for one period.">
                  <CompositionSnapshot
                    axis={chartModel.axis}
                    buckets={chartModel.buckets}
                    composition={chartModel.composition}
                    periodIndex={snapshotIndex}
                    onPeriodChange={setSnapshotIndex}
                    onDrill={drillInto}
                  />
                </ChartCard>
              </div>

              <ChartCard title="Delta trend" subtitle="Period-over-period change of the scope total.">
                <DeltaTrendChart
                  axis={chartModel.axis}
                  node={chartModel.aggregate}
                  deltaMode={viewState.deltaMode}
                  onDeltaModeChange={m => patch({ deltaMode: m })}
                />
              </ChartCard>

              {comparisonModel && <ComparisonPanel model={comparisonModel} />}
            </>
          ) : null}

          <p className="text-xs text-ink-muted">
            Interior blank periods are shown as gaps and never interpolated; leading and trailing all-blank periods are trimmed. Exclusive items are never included in any total, series, breakdown or export.
          </p>

          {/* Scoped Dashboard is the lowest section on the page — it renders whenever a
              scope is resolvable, independent of the charts' empty state above. */}
          {scoped && (
            <ScopedDashboardSection
              scoped={scoped}
              viewState={viewState}
              subCaption={subCaption}
              onChange={patch}
              onDrillItem={drillInto}
            />
          )}
        </>
      )}
    </div>
  )
}

function zeroStat() {
  return {
    latestValue: null, latestPeriodLabel: null, latestDeltaAmount: null, latestDeltaPercent: null,
    rangeChangeAmount: null, rangeChangePercent: null, rangeSpanLabel: null, annualisedPercent: null,
    populatedCount: 0, totalPeriods: 0,
  }
}

function emptyCmpRow() {
  return { name: '', valueA: null, valueB: null, delta: null, deltaPercent: null }
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-ink-muted text-sm">Loading…</div>}>
      <AnalysisPageInner />
    </Suspense>
  )
}
