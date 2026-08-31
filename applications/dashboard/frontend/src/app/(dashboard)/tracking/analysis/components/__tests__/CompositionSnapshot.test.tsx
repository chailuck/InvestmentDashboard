import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { deriveChartModel } from '@/lib/tracking-analysis'
import { CompositionSnapshot } from '../CompositionSnapshot'
import { makeGrid, makeViewState } from '../../__tests__/fixtures'

function model() {
  return deriveChartModel(makeGrid(), makeViewState())
}

describe('CompositionSnapshot', () => {
  it('ranks buckets for the selected period and lists their values', () => {
    const m = model()
    render(
      <CompositionSnapshot axis={m.axis} buckets={m.buckets} composition={m.composition} periodIndex={m.axis.length - 1} onPeriodChange={vi.fn()} onDrill={vi.fn()} />,
    )
    // last populated period is 2024 Q2 — Assets (1470) ranks above Misc (60)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Assets')
    expect(rows[1]).toHaveTextContent('Misc')
  })

  it('the period stepper only moves across populated periods and calls back', async () => {
    const m = model()
    const onPeriodChange = vi.fn()
    render(
      <CompositionSnapshot axis={m.axis} buckets={m.buckets} composition={m.composition} periodIndex={m.axis.length - 1} onPeriodChange={onPeriodChange} onDrill={vi.fn()} />,
    )
    const prev = screen.getByRole('button', { name: /previous populated period/i })
    await userEvent.click(prev)
    expect(onPeriodChange).toHaveBeenCalled()
  })

  it('value / share toggle switches units', async () => {
    const m = model()
    render(
      <CompositionSnapshot axis={m.axis} buckets={m.buckets} composition={m.composition} periodIndex={m.axis.length - 1} onPeriodChange={vi.fn()} onDrill={vi.fn()} />,
    )
    const share = screen.getByRole('button', { name: 'Share %' })
    await userEvent.click(share)
    expect(share).toHaveAttribute('aria-pressed', 'true')
  })

  it('bar label click drills into the bucket', async () => {
    const m = model()
    const onDrill = vi.fn()
    render(
      <CompositionSnapshot axis={m.axis} buckets={m.buckets} composition={m.composition} periodIndex={m.axis.length - 1} onPeriodChange={vi.fn()} onDrill={onDrill} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Assets' }))
    expect(onDrill).toHaveBeenCalledWith('c1')
  })
})
