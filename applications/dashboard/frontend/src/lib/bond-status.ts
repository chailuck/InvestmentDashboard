import type { BondStatus } from '@/services/tracking'

/**
 * Client mirror of the backend's bond-status derivation, used ONLY for a
 * transient in-form preview while the user is entering/editing term dates —
 * the register table always renders the authoritative `bond.status` from the
 * server, never this.
 *
 * Rules (identical to the backend):
 *  - either date missing            -> 'Unknown'
 *  - today  <  startDate            -> 'Pre-order'
 *  - today  >  expiredDate          -> 'Expire'
 *  - otherwise (inclusive bounds)   -> 'Active'
 *
 * All three arguments are ISO date strings (yyyy-MM-dd), which sort
 * lexically, so plain string comparison is a correct date comparison.
 *
 * @param start   Bond start date (ISO) or `null`.
 * @param expired Bond expiry date (ISO) or `null`.
 * @param today   Reference "now" date (ISO) — pass the caller's current date.
 */
export function computeBondStatus(
  start: string | null,
  expired: string | null,
  today: string,
): BondStatus {
  if (!start || !expired) return 'Unknown'
  if (today < start) return 'Pre-order'
  if (today > expired) return 'Expire'
  return 'Active'
}

const YEARS_DIVISOR = 365.25

/**
 * Client mirror of backend app/services/bond_status.compute_bond_years.
 * Transient in-form preview ONLY — the register table renders the
 * authoritative server `bond.years`, never this.
 * null when either date is missing. Negative span passes through (no clamp).
 * MUST stay result-identical to the Python function.
 */
export function computeBondYears(start: string | null, expired: string | null): number | null {
  if (!start || !expired) return null
  const days = Math.round(
    (Date.parse(`${expired}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  )
  const raw = days / YEARS_DIVISOR
  // Python decimal.ROUND_HALF_UP == ties AWAY FROM ZERO. JS Math.round ties
  // toward +Infinity (-0.5 -> -0), so round the magnitude and re-apply sign.
  return Math.sign(raw) * Math.round(Math.abs(raw))
}
