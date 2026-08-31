import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import AnalysisPage from '../page'
import { trackingService } from '@/services/tracking'
import type { TrackingSet } from '@/services/tracking'
import { makeGrid } from './fixtures'

vi.mock('@/services/tracking', () => ({
  trackingService: {
    listSets: vi.fn(),
    getBalanceGrid: vi.fn(),
  },
  TRACKING_ITEM_TYPES: ['Bank account', 'Property', 'Investment Account', 'TaxSaving', 'Materials', 'Insurance'],
}))

const mocked = vi.mocked(trackingService)
const SETS: TrackingSet[] = [{ id: 'set-1', name: 'Main Set', description: null, createdAt: '', updatedAt: '' }]

beforeEach(() => {
  vi.clearAllMocks()
  mocked.listSets.mockResolvedValue(SETS)
  mocked.getBalanceGrid.mockResolvedValue(makeGrid())
})

describe('Analysis page', () => {
  it('prompts to create a tracking set when the user has none', async () => {
    mocked.listSets.mockResolvedValue([])
    render(<AnalysisPage />)
    expect(await screen.findByText(/create a tracking set/i)).toBeInTheDocument()
  })

  it('shows a "no quarterly data" prompt when the grid has no years', async () => {
    mocked.getBalanceGrid.mockResolvedValue({ ...makeGrid(), years: [] })
    render(<AnalysisPage />)
    expect(await screen.findByText(/no quarterly data yet/i)).toBeInTheDocument()
  })

  it('renders the control bar, breadcrumb, KPI row, scoped section and the charts', async () => {
    render(<AnalysisPage />)
    expect(await screen.findByRole('group', { name: /amount type lens/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /drill path/i })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: /key figures/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /scoped dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Trend' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Composition over time' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Delta trend' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export view \(csv\)/i })).toBeEnabled()
  })

  it('renders the Scoped Dashboard as the last major section — after the Delta trend chart', async () => {
    render(<AnalysisPage />)
    await screen.findByRole('heading', { name: 'Delta trend' })
    const deltaHeading = screen.getByRole('heading', { name: 'Delta trend' })
    const scopedSection = screen.getByRole('button', { name: /scoped dashboard/i })
    // Scoped Dashboard must follow the Delta trend chart (and the ComparisonPanel,
    // when present) in DOM order — it is the lowest section on the page.
    expect(
      deltaHeading.compareDocumentPosition(scopedSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('switching the lens keeps the drill path and updates the pressed state', async () => {
    render(<AnalysisPage />)
    const lensGroup = await screen.findByRole('group', { name: /amount type lens/i })
    const property = within(lensGroup).getByRole('button', { name: 'Property' })
    await userEvent.click(property)
    expect(property).toHaveAttribute('aria-pressed', 'true')
  })

  it('drilling from the trend chart advances the breadcrumb', async () => {
    render(<AnalysisPage />)
    await screen.findByRole('heading', { name: 'Trend' })
    const drillRow = screen.getByText('Drill into:').parentElement as HTMLElement
    await userEvent.click(within(drillRow).getByRole('button', { name: 'Assets' }))
    const nav = screen.getByRole('navigation', { name: /drill path/i })
    await waitFor(() => expect(within(nav).getByText('Assets')).toBeInTheDocument())
  })

  it('fetches the balance grid exactly once for the selected set', async () => {
    render(<AnalysisPage />)
    await screen.findByRole('heading', { name: 'Trend' })
    expect(mocked.getBalanceGrid).toHaveBeenCalledTimes(1)
    expect(mocked.getBalanceGrid).toHaveBeenCalledWith('set-1')
  })

  it('a granularity change that clears an active comparison surfaces the AC-9 notice', async () => {
    render(<AnalysisPage />)
    const cmpGroup = await screen.findByRole('group', { name: /period comparison/i })
    await userEvent.click(within(cmpGroup).getByRole('button', { name: 'QoQ' }))
    const granGroup = screen.getByRole('group', { name: /time granularity/i })
    await userEvent.click(within(granGroup).getByRole('button', { name: 'Yearly' }))
    expect(await screen.findByText('Comparison cleared due to granularity change')).toBeInTheDocument()
  })

  it('a URL drill path that no longer resolves falls back to the default landing view', async () => {
    // hydrate a bogus category id via the mocked search params
    const nav = await import('next/navigation')
    vi.spyOn(nav, 'useSearchParams').mockReturnValue(new URLSearchParams('cat=does-not-exist') as never)
    render(<AnalysisPage />)
    await screen.findByRole('heading', { name: 'Trend' })
    const bc = screen.getByRole('navigation', { name: /drill path/i })
    // only the lens crumb remains — no "Category" crumb was resolvable
    expect(within(bc).queryByText('Category')).not.toBeInTheDocument()
    expect(within(bc).getByText('Grand Total')).toBeInTheDocument()
    vi.mocked(nav.useSearchParams).mockReturnValue(new URLSearchParams() as never)
  })
})

// ---------------------------------------------------------------------------
// CSV export wiring (AC-21, AC-22, AC-SD-31..33)
// ---------------------------------------------------------------------------

describe('Analysis page — CSV export wiring', () => {
  const RealBlob = global.Blob
  let blobParts: string[]
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    blobParts = []
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock')
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn()
    global.Blob = vi.fn((parts: unknown[]) => {
      blobParts.push(String((parts as unknown[])[0]))
      return new RealBlob(parts as BlobPart[])
    }) as unknown as typeof Blob
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })
  afterEach(() => {
    global.Blob = RealBlob
    clickSpy.mockRestore()
  })

  const exportNow = async () => {
    await userEvent.click(screen.getByRole('button', { name: /export view \(csv\)/i }))
    return blobParts[0] // main CSV, BOM-prefixed
  }
  const bodyLines = (csv: string) =>
    csv.replace(/^﻿/, '').trimEnd().split('\r\n')
      .filter(l => l && !l.startsWith('#') && !l.startsWith('tracking_set,'))

  it('AC-21 — one row per bucket × period, figures match the model, NO exclusive items, context header lines present', async () => {
    render(<AnalysisPage />)
    await screen.findByRole('heading', { name: 'Trend' })
    const csv = await exportNow()

    // BOM
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    // context comments
    expect(csv).toContain('# lens: Grand Total')
    expect(csv).toContain('# drill_path: Grand Total')
    expect(csv).toContain('# granularity: Quarterly')
    expect(csv).toContain('# measure: balance')
    expect(csv).toMatch(/# generated_at: \d{4}-\d{2}-\d{2}T/)

    // fixture trimmed quarterly window = 3 periods; buckets = Assets, Misc (+ aggregate)
    // → (2 buckets + 1 aggregate) × 3 periods = 9 data rows
    const lines = bodyLines(csv)
    expect(lines).toHaveLength(9)

    // figures match the derived model (Assets / Misc / Grand Total total at Q2 2024)
    expect(lines.some(l => l.includes(',Assets,category,') && l.includes('Q2 2024') && l.includes(',1470,'))).toBe(true)
    expect(lines.some(l => l.includes(',Misc,category,') && l.includes('Q2 2024') && l.includes(',60,'))).toBe(true)
    expect(lines.some(l => l.includes('Grand Total total,aggregate,') && l.includes('Q2 2024') && l.includes(',1530,'))).toBe(true)

    // NO exclusive item anywhere
    expect(csv).not.toContain('SideBet')
  })

  it('AC-22 — a Thai tracking-set name round-trips and the file carries a UTF-8 BOM', async () => {
    mocked.listSets.mockResolvedValue([{ id: 'set-1', name: 'บ้านและเงินสด', description: null, createdAt: '', updatedAt: '' }])
    render(<AnalysisPage />)
    await screen.findByRole('heading', { name: 'Trend' })
    const csv = await exportNow()
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('# tracking_set: บ้านและเงินสด')
    expect(csv).toContain('บ้านและเงินสด,Grand Total,')
  })

  it('AC-SD-31..33 — scoped-grid rows are excluded at depth 0 and included once drilled (section expanded)', async () => {
    render(<AnalysisPage />)
    await screen.findByRole('heading', { name: 'Trend' })

    // depth 0 — Scoped Dashboard collapsed → no scope rows
    const csv0 = await exportNow()
    expect(csv0).not.toContain(',scopeTotal,')
    expect(csv0).not.toContain(',subCategoryTotal,')

    // drill into "Assets" → depth 1, section auto-expands
    blobParts.length = 0
    const drillRow = screen.getByText('Drill into:').parentElement as HTMLElement
    await userEvent.click(within(drillRow).getByRole('button', { name: 'Assets' }))
    await waitFor(() => expect(screen.getAllByText('Total: Assets').length).toBeGreaterThan(0))

    const csv1 = await exportNow()
    expect(csv1).toContain('Total: Assets,scopeTotal,')
    expect(csv1).toContain(',subCategoryTotal,')
    expect(csv1).toContain('# drill_path: Grand Total › Assets')
  })
})
