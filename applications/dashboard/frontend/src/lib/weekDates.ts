import { startOfWeek, addDays, addWeeks, format, isToday } from 'date-fns'

export interface WeekDay {
  date: Date
  label: string      // "Mon", "Tue", "Wed", "Thu", "Fri"
  dateLabel: string  // "16 Jun"
  isToday: boolean
  isoDate: string    // "2026-06-16" — for price lookup
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const

/**
 * Returns the 5 weekdays (Mon–Fri) for the week that is `weekOffset` weeks
 * from the current week.
 * weekOffset = 0  → current week
 * weekOffset = -1 → last week
 * weekOffset = +1 → next week
 */
export function getWeekDays(weekOffset: number = 0): WeekDay[] {
  const baseMonday = startOfWeek(new Date(), { weekStartsOn: 1 })
  const targetMonday = addWeeks(baseMonday, weekOffset)
  return DAY_LABELS.map((label, i) => {
    const date = addDays(targetMonday, i)
    return {
      date,
      label,
      dateLabel: format(date, 'd MMM'),
      isoDate: format(date, 'yyyy-MM-dd'),
      isToday: weekOffset === 0 && isToday(date),
    }
  })
}

/** Convenience wrapper — keeps backward compatibility with existing callers */
export function getCurrentWeekDays(): WeekDay[] {
  return getWeekDays(0)
}
