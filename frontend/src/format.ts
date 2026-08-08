/**
 * Display formatters shared across surfaces.
 *
 * `formatMoney` lived in `components.tsx` and is still re-exported from there,
 * so every existing import keeps working. It moved here so modules that
 * `components.tsx` itself imports — the economy ledger, for one — can format
 * currency without creating an import cycle.
 */

export function formatMoney(value: number, compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    notation: compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
  }).format(value)
}

/**
 * A change, written the way a ledger writes one: an explicit sign, and a minus
 * rather than a hyphen so a subtraction does not read as a range.
 */
export function formatMoneyDelta(delta: number, compact = true) {
  return `${delta < 0 ? '−' : '+'}${formatMoney(Math.abs(delta), compact)}`
}

export function formatCountDelta(delta: number) {
  return `${delta < 0 ? '−' : '+'}${Math.abs(delta).toLocaleString()}`
}
