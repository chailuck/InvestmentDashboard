import { INDICATOR_CONFIG } from '@/config/indicators'

export type PeDir    = 'up' | 'down' | 'stable' | 'zero'
export type PriceDir = 'up' | 'down' | 'stable'
export type PeIndicator = 'very_good' | 'good' | 'normal' | 'bad' | 'very_bad'

export interface TimelinePoint {
  date: string
  state: PeIndicator
  peDir: PeDir
  priceDir: PriceDir
  peChg: number | null
  priceChg: number
}

export const INDICATOR_TABLE: Record<`${PeDir}-${PriceDir}`, PeIndicator> = {
  'up-up': 'normal',   'up-stable': 'very_good',  'up-down': 'very_bad',
  'down-up': 'very_good', 'down-stable': 'very_good', 'down-down': 'normal',
  'stable-up': 'very_good', 'stable-stable': 'normal', 'stable-down': 'bad',
  'zero-up': 'very_bad', 'zero-stable': 'very_bad', 'zero-down': 'very_bad',
}

export const INDICATOR_DOT: Record<PeIndicator, string> = {
  very_good: '#10B981',
  good:      '#34D399',
  normal:    '#4B5563',
  bad:       '#F59E0B',
  very_bad:  '#EF4444',
}

export const PE_INDICATOR_LEVELS: {
  key: PeIndicator; label: string; desc: string; dot: string
}[] = [
  { key: 'very_good', label: 'Very Good', desc: 'PE↓ Price↑  or  PE↓ steady',   dot: '#10B981' },
  { key: 'good',      label: 'Good',      desc: 'Positive trend',               dot: '#34D399' },
  { key: 'normal',    label: 'Normal',    desc: 'Both up or both down',          dot: '#4B5563' },
  { key: 'bad',       label: 'Bad',       desc: 'Steady PE, price declining',    dot: '#F59E0B' },
  { key: 'very_bad',  label: 'Very Bad',  desc: 'PE↑ Price↓  or  zero/neg PE',  dot: '#EF4444' },
]

export function computeWeeklyIndicators(
  priceData: { date: string; price: number; open?: number }[],
  peData:    { date: string; pe: number;    pe_open?: number }[],
  thresholds: { peThreshold: number; priceThreshold: number } = {
    peThreshold:    INDICATOR_CONFIG.peThreshold,
    priceThreshold: INDICATOR_CONFIG.priceThreshold,
  },
): TimelinePoint[] {
  if (!priceData.length) return []

  const peMap = new Map(peData.map(d => [d.date, d]))

  return priceData.map((d, i) => {
    const peEntry = peMap.get(d.date)
    const pe      = peEntry?.pe ?? null

    // Price slope: prev-week close → this-week close
    const prevPrice = i > 0 ? priceData[i - 1].price : d.price
    const priceChg  = prevPrice ? ((d.price - prevPrice) / prevPrice) * 100 : 0
    const pt        = thresholds.priceThreshold
    const priceDir: PriceDir = priceChg > pt ? 'up' : priceChg < -pt ? 'down' : 'stable'

    if (!pe || pe <= 0.5) {
      return { date: d.date, state: INDICATOR_TABLE[`zero-${priceDir}`], peDir: 'zero' as PeDir, priceDir, peChg: null, priceChg }
    }

    // PE slope: prev-week PE close → this-week PE close
    const prevPeEntry = i > 0 ? peMap.get(priceData[i - 1].date) : undefined
    const prevPe      = prevPeEntry?.pe ?? pe
    const peChg       = prevPe > 0 ? ((pe - prevPe) / prevPe) * 100 : 0
    const pp          = thresholds.peThreshold
    const peDir: PeDir = peChg > pp ? 'up' : peChg < -pp ? 'down' : 'stable'

    return { date: d.date, state: INDICATOR_TABLE[`${peDir}-${priceDir}`], peDir, priceDir, peChg, priceChg }
  })
}
