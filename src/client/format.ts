/**
 * Display formatters for the overview figures and the toolbar.
 *
 * Every formatter is total over `unknown`: the values reach a plugin as Host
 * projection wire data, so a missing or mistyped field renders as the dash
 * rather than breaking a card.
 *
 * @module dsh-session-map/client/format
 */

/**
 * Render a millisecond duration.
 * @param ms - duration in milliseconds, as wire data.
 * @returns seconds, minutes, or the dash when the value is not a positive duration.
 */
export function formatMs(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return Math.round(ms) + ' ms'
  const seconds = ms / 1000
  if (seconds < 60) return seconds.toFixed(1) + ' s'
  const minutes = Math.floor(seconds / 60)
  return minutes + ' min ' + Math.round(seconds - minutes * 60) + ' s'
}

/**
 * Render a count.
 * @param value - count as wire data.
 * @returns the number as text, or the dash when it is not one.
 */
export function formatCount(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return String(value)
}

/**
 * Clamp a finite number into a range, falling back to the lower bound.
 * @param value - the number to clamp.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns the clamped value, or `min` when `value` is not finite.
 */
export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * The message of a thrown value, or its string form when it carries none.
 * @param cause - the thrown value.
 * @returns display text for the error.
 */
export function errorText(cause: unknown): string {
  const message: unknown = typeof cause === 'object' && cause !== null
    ? (cause as { readonly message?: unknown }).message
    : undefined
  return String(message ? message : cause)
}
