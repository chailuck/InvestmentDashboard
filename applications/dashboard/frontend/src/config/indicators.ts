/**
 * Global indicator thresholds — adjust here to tune sensitivity across the entire app.
 * These are developer-level settings, not user-configurable.
 */
export const INDICATOR_CONFIG = {
  /** Intra-week PE change % required to classify as up/down (vs stable). */
  peThreshold: 0.5,
  /** Intra-week price change % required to classify as up/down (vs stable). */
  priceThreshold: 3,
} as const
