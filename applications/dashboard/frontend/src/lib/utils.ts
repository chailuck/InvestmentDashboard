import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import numeral from 'numeral'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number, compact = false): string {
  if (compact) {
    if (Math.abs(value) >= 1_000_000_000) return `$${numeral(value).format('0.00a')}`.toUpperCase()
    if (Math.abs(value) >= 1_000_000) return `$${numeral(value).format('0.00a')}`.toUpperCase()
    if (Math.abs(value) >= 1_000) return `$${numeral(value).format('0.0a')}`.toUpperCase()
  }
  return numeral(value).format('$0,0.00')
}

export function formatPct(value: number, decimals = 2): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

export function formatNumber(value: number, decimals = 2): string {
  return numeral(value).format(`0,0.${'0'.repeat(decimals)}`)
}

export function formatCompact(value: number): string {
  return numeral(value).format('0.0a').toUpperCase()
}

export function isPositive(value: number): boolean {
  return value > 0
}

export function isNegative(value: number): boolean {
  return value < 0
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: any[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }) as T
}
