import { describe, it, expect, vi, afterEach } from 'vitest'
import { getCurrentWeekDays, getWeekDays } from './weekDates'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pin the system clock to a specific ISO timestamp for the duration of a test.
 * Using vi.useFakeTimers / vi.setSystemTime so that `new Date()` and
 * date-fns helpers (isToday, startOfWeek, etc.) all see the same value.
 */
function setSystemDate(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('getCurrentWeekDays', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Shape / invariants ─────────────────────────────────────────────────────

  it('returns exactly 5 days', () => {
    setSystemDate('2026-06-17T10:00:00.000Z') // a Tuesday
    const days = getCurrentWeekDays()
    expect(days).toHaveLength(5)
  })

  it('each day has the required fields: date, label, dateLabel, isToday, isoDate', () => {
    setSystemDate('2026-06-17T10:00:00.000Z')
    const days = getCurrentWeekDays()
    for (const day of days) {
      expect(day).toHaveProperty('date')
      expect(day).toHaveProperty('label')
      expect(day).toHaveProperty('dateLabel')
      expect(day).toHaveProperty('isToday')
      expect(day).toHaveProperty('isoDate')
      expect(day.date).toBeInstanceOf(Date)
      expect(typeof day.label).toBe('string')
      expect(typeof day.dateLabel).toBe('string')
      expect(typeof day.isToday).toBe('boolean')
      expect(typeof day.isoDate).toBe('string')
    }
  })

  it('isoDate matches yyyy-MM-dd format for all 5 days', () => {
    setSystemDate('2026-06-15T10:00:00.000Z') // Monday 15 Jun 2026
    const days = getCurrentWeekDays()
    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    for (const day of days) {
      expect(day.isoDate).toMatch(isoRe)
    }
    expect(days[0].isoDate).toBe('2026-06-15')
    expect(days[1].isoDate).toBe('2026-06-16')
    expect(days[2].isoDate).toBe('2026-06-17')
    expect(days[3].isoDate).toBe('2026-06-18')
    expect(days[4].isoDate).toBe('2026-06-19')
  })

  it('returns Mon / Tue / Wed / Thu / Fri labels in order', () => {
    setSystemDate('2026-06-17T10:00:00.000Z')
    const labels = getCurrentWeekDays().map(d => d.label)
    expect(labels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  })

  // ── Monday anchor ──────────────────────────────────────────────────────────

  it('day[0].date is always a Monday (getDay() === 1)', () => {
    setSystemDate('2026-06-17T10:00:00.000Z') // Tuesday
    const days = getCurrentWeekDays()
    expect(days[0].date.getDay()).toBe(1)
  })

  it('each successive date is exactly 1 calendar day after the previous', () => {
    setSystemDate('2026-06-17T10:00:00.000Z')
    const days = getCurrentWeekDays()
    for (let i = 1; i < days.length; i++) {
      const diff = days[i].date.getTime() - days[i - 1].date.getTime()
      expect(diff).toBe(24 * 60 * 60 * 1000)
    }
  })

  // ── isToday accuracy ───────────────────────────────────────────────────────

  it('isToday is true for Monday when today is Monday', () => {
    setSystemDate('2026-06-15T08:00:00.000Z') // Monday 15 Jun 2026
    const days = getCurrentWeekDays()
    expect(days[0].isToday).toBe(true)
    expect(days[1].isToday).toBe(false)
    expect(days[2].isToday).toBe(false)
    expect(days[3].isToday).toBe(false)
    expect(days[4].isToday).toBe(false)
  })

  it('isToday is true for Tuesday when today is Tuesday', () => {
    setSystemDate('2026-06-16T09:00:00.000Z') // Tuesday 16 Jun 2026
    const days = getCurrentWeekDays()
    expect(days[0].isToday).toBe(false)
    expect(days[1].isToday).toBe(true)
    expect(days[2].isToday).toBe(false)
    expect(days[3].isToday).toBe(false)
    expect(days[4].isToday).toBe(false)
  })

  it('isToday is true for Wednesday when today is Wednesday', () => {
    setSystemDate('2026-06-17T12:00:00.000Z') // Wednesday 17 Jun 2026
    const days = getCurrentWeekDays()
    expect(days[2].isToday).toBe(true)
    expect(days.filter(d => d.isToday)).toHaveLength(1)
  })

  it('isToday is true for Thursday when today is Thursday', () => {
    setSystemDate('2026-06-18T07:30:00.000Z') // Thursday 18 Jun 2026
    const days = getCurrentWeekDays()
    expect(days[3].isToday).toBe(true)
    expect(days.filter(d => d.isToday)).toHaveLength(1)
  })

  it('isToday is true for Friday when today is Friday', () => {
    setSystemDate('2026-06-19T16:00:00.000Z') // Friday 19 Jun 2026
    const days = getCurrentWeekDays()
    expect(days[4].isToday).toBe(true)
    expect(days.filter(d => d.isToday)).toHaveLength(1)
  })

  it('exactly one day has isToday === true on a weekday', () => {
    setSystemDate('2026-06-17T10:00:00.000Z') // Wednesday
    const days = getCurrentWeekDays()
    const todayDays = days.filter(d => d.isToday)
    expect(todayDays).toHaveLength(1)
  })

  // ── Weekend behavior ───────────────────────────────────────────────────────

  it('returns Mon–Fri of the current ISO week when today is Saturday', () => {
    setSystemDate('2026-06-20T10:00:00.000Z') // Saturday 20 Jun 2026
    const days = getCurrentWeekDays()
    expect(days).toHaveLength(5)
    expect(days[0].date.getDay()).toBe(1) // still Monday 15 Jun
    // Specifically: Mon 15 Jun through Fri 19 Jun
    expect(days[0].dateLabel).toBe('15 Jun')
    expect(days[4].dateLabel).toBe('19 Jun')
  })

  it('returns Mon–Fri of the current ISO week when today is Sunday', () => {
    setSystemDate('2026-06-21T10:00:00.000Z') // Sunday 21 Jun 2026
    const days = getCurrentWeekDays()
    expect(days).toHaveLength(5)
    expect(days[0].date.getDay()).toBe(1) // Monday 15 Jun
    expect(days[0].dateLabel).toBe('15 Jun')
    expect(days[4].dateLabel).toBe('19 Jun')
  })

  it('no day has isToday === true when today is Saturday', () => {
    setSystemDate('2026-06-20T10:00:00.000Z') // Saturday
    const days = getCurrentWeekDays()
    expect(days.every(d => d.isToday === false)).toBe(true)
  })

  it('no day has isToday === true when today is Sunday', () => {
    setSystemDate('2026-06-21T10:00:00.000Z') // Sunday
    const days = getCurrentWeekDays()
    expect(days.every(d => d.isToday === false)).toBe(true)
  })

  // ── dateLabel format ───────────────────────────────────────────────────────

  it('dateLabel matches "d MMM" format (e.g. "15 Jun")', () => {
    setSystemDate('2026-06-15T10:00:00.000Z') // Monday 15 Jun 2026
    const days = getCurrentWeekDays()
    expect(days[0].dateLabel).toBe('15 Jun')
    expect(days[1].dateLabel).toBe('16 Jun')
    expect(days[2].dateLabel).toBe('17 Jun')
    expect(days[3].dateLabel).toBe('18 Jun')
    expect(days[4].dateLabel).toBe('19 Jun')
  })

  it('dateLabel day number has no leading zero (uses "d" not "dd")', () => {
    setSystemDate('2026-06-01T10:00:00.000Z') // Monday 1 Jun 2026
    const days = getCurrentWeekDays()
    expect(days[0].dateLabel).toBe('1 Jun')
  })

  // ── Week boundary — crosses month ──────────────────────────────────────────

  it('correctly spans a month boundary (Thu–Fri fall in the next month)', () => {
    setSystemDate('2026-06-29T10:00:00.000Z') // Monday 29 Jun 2026
    const days = getCurrentWeekDays()
    expect(days[0].dateLabel).toBe('29 Jun')
    expect(days[1].dateLabel).toBe('30 Jun')
    expect(days[2].dateLabel).toBe('1 Jul')
    expect(days[3].dateLabel).toBe('2 Jul')
    expect(days[4].dateLabel).toBe('3 Jul')
  })

  // ── Year boundary ──────────────────────────────────────────────────────────

  it('correctly spans a year boundary (week straddles Dec 31 / Jan 1)', () => {
    // Mon 29 Dec 2025 → Fri 2 Jan 2026
    setSystemDate('2025-12-29T10:00:00.000Z') // Monday 29 Dec 2025
    const days = getCurrentWeekDays()
    expect(days[0].dateLabel).toBe('29 Dec')
    expect(days[1].dateLabel).toBe('30 Dec')
    expect(days[2].dateLabel).toBe('31 Dec')
    expect(days[3].dateLabel).toBe('1 Jan')
    expect(days[4].dateLabel).toBe('2 Jan')
  })

  // ── Independent calls produce consistent state ─────────────────────────────

  it('calling getCurrentWeekDays() twice returns equal results', () => {
    setSystemDate('2026-06-17T10:00:00.000Z')
    const first = getCurrentWeekDays()
    const second = getCurrentWeekDays()
    expect(first.map(d => d.label)).toEqual(second.map(d => d.label))
    expect(first.map(d => d.dateLabel)).toEqual(second.map(d => d.dateLabel))
    expect(first.map(d => d.isToday)).toEqual(second.map(d => d.isToday))
  })

  it('mutating the returned array does not affect a subsequent call', () => {
    setSystemDate('2026-06-17T10:00:00.000Z')
    const first = getCurrentWeekDays()
    first.push({ date: new Date(), label: 'Sat', dateLabel: '20 Jun', isToday: false, isoDate: '2026-06-20' })
    const second = getCurrentWeekDays()
    expect(second).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// getWeekDays — offset navigation
// ---------------------------------------------------------------------------

describe('getWeekDays', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // TC-WD-22: prior week
  it('offset -1 returns Mon–Fri of the previous week', () => {
    setSystemDate('2026-06-17T10:00:00.000Z') // Wednesday 17 Jun 2026 — current week is 15–19 Jun
    const days = getWeekDays(-1)
    expect(days).toHaveLength(5)
    expect(days[0].date.getDay()).toBe(1)       // Monday
    expect(days[0].isoDate).toBe('2026-06-08')  // Mon 8 Jun (prior week)
    expect(days[4].isoDate).toBe('2026-06-12')  // Fri 12 Jun
    expect(days.every(d => d.isToday === false)).toBe(true) // no day is today
  })

  // TC-WD-23: next week
  it('offset +1 returns Mon–Fri of the next week', () => {
    setSystemDate('2026-06-17T10:00:00.000Z') // Wednesday 17 Jun 2026
    const days = getWeekDays(1)
    expect(days).toHaveLength(5)
    expect(days[0].isoDate).toBe('2026-06-22')  // Mon 22 Jun
    expect(days[4].isoDate).toBe('2026-06-26')  // Fri 26 Jun
    expect(days.every(d => d.isToday === false)).toBe(true)
  })

  // TC-WD-24: far past (-52 weeks)
  it('offset -52 does not throw and returns a valid Mon–Fri week', () => {
    setSystemDate('2026-06-17T10:00:00.000Z')
    expect(() => getWeekDays(-52)).not.toThrow()
    const days = getWeekDays(-52)
    expect(days).toHaveLength(5)
    expect(days[0].date.getDay()).toBe(1)
    expect(days.every(d => d.isToday === false)).toBe(true)
  })

  // TC-WD-25: isoDate format for non-zero offsets
  it('isoDate fields use yyyy-MM-dd format for non-zero offsets', () => {
    setSystemDate('2026-06-17T10:00:00.000Z')
    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    for (const offset of [-2, -1, 1, 2]) {
      const days = getWeekDays(offset)
      for (const day of days) {
        expect(day.isoDate).toMatch(isoRe)
      }
    }
  })

  // isToday suppressed for all non-zero offsets
  it('isToday is always false for non-zero weekOffset', () => {
    setSystemDate('2026-06-17T10:00:00.000Z') // today is Wednesday
    for (const offset of [-3, -2, -1, 1, 2]) {
      const days = getWeekDays(offset)
      expect(days.every(d => d.isToday === false)).toBe(true)
    }
  })

  // offset=0 behaves identically to getCurrentWeekDays
  it('offset 0 produces the same output as getCurrentWeekDays()', () => {
    setSystemDate('2026-06-17T10:00:00.000Z')
    const via0 = getWeekDays(0)
    const viaCurrent = getCurrentWeekDays()
    expect(via0.map(d => d.isoDate)).toEqual(viaCurrent.map(d => d.isoDate))
    expect(via0.map(d => d.label)).toEqual(viaCurrent.map(d => d.label))
    expect(via0.map(d => d.isToday)).toEqual(viaCurrent.map(d => d.isToday))
  })

  // Labels are always Mon–Fri regardless of offset
  it('labels are always Mon–Fri in order for any offset', () => {
    setSystemDate('2026-06-17T10:00:00.000Z')
    for (const offset of [-5, -1, 0, 1, 5]) {
      const labels = getWeekDays(offset).map(d => d.label)
      expect(labels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    }
  })
})
