'use client'

import { LensSelect } from './LensSelect'
import { GranularityToggle } from './GranularityToggle'
import { MeasureSelect } from './MeasureSelect'
import { GroupBySelect } from './GroupBySelect'
import { ComparisonControl } from './ComparisonControl'
import { allowedGroupBy, defaultGroupBy, drillDepth } from '@/lib/tracking-analysis'
import type {
  ComparisonConfig,
  Granularity,
  GroupByDim,
  Lens,
  Measure,
  PeriodRef,
  ViewState,
} from '../types'

/**
 * §4.2 / §4.3 — the single global control row that scopes every chart, the
 * Scoped Dashboard and the export. Controls are never per-chart.
 */
export function AnalysisControlBar({
  viewState,
  populatedPeriods,
  onChange,
}: {
  viewState: ViewState
  populatedPeriods: { ref: PeriodRef; label: string }[]
  onChange: (patch: Partial<ViewState>) => void
}) {
  const depth = drillDepth(viewState.drill)
  const allowed = allowedGroupBy(depth)

  const setLens = (lens: Lens) => onChange({ lens, drill: { ...viewState.drill, lens }, snapshotPeriod: undefined })
  const setGranularity = (granularity: Granularity) =>
    onChange({
      granularity,
      // §AC-9 — comparisons never mix a quarter with a year.
      comparison: viewState.comparison.mode === 'off' ? viewState.comparison : { mode: 'off' },
      snapshotPeriod: undefined,
    })
  const setMeasure = (measure: Measure) => onChange({ measure })
  const setGroupBy = (groupBy: GroupByDim) => onChange({ groupBy })
  const setComparison = (comparison: ComparisonConfig) => onChange({ comparison })

  return (
    <div className="card p-3 flex flex-wrap items-center gap-x-4 gap-y-2 sticky top-0 z-10">
      <LensSelect value={viewState.lens} onChange={setLens} />
      <GranularityToggle value={viewState.granularity} onChange={setGranularity} />
      <MeasureSelect value={viewState.measure} onChange={setMeasure} />
      <GroupBySelect
        value={allowed.includes(viewState.groupBy) ? viewState.groupBy : defaultGroupBy(depth)}
        allowed={allowed}
        onChange={setGroupBy}
        disabled={depth === 3}
      />
      <ComparisonControl
        value={viewState.comparison}
        populatedPeriods={populatedPeriods}
        onChange={setComparison}
      />
    </div>
  )
}
