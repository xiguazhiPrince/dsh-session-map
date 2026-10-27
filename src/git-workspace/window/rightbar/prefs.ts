/**
 * Per-session UI preferences of the Git right-column page.
 *
 * Only presentation lives here: which panes are open, how wide the commit panel
 * is, how tall the log area is, and which diff presentation the reader picked.
 * Selection and search text stay transient. Storage can be denied (private
 * mode, blocked site data), in which case every read falls back to the defaults
 * and every write is ignored — the page keeps working.
 *
 * @module dsh-session-map/git-workspace/window/rightbar/prefs
 */

/** Diff presentation preference: `auto` follows the measured width. */
export type DiffModePref = 'auto' | 'unified' | 'side'

/** One Session's page preferences. */
export interface GitRightbarPrefs {
  /** Whether the commit panel is open; `null` means "follow the width". */
  readonly commitOpen: boolean | null
  /** Width of the commit panel, in px. */
  readonly commitWidth: number
  /** Height of the log area, in px. */
  readonly logHeight: number
  /** Diff presentation preference. */
  readonly diffMode: DiffModePref
}

/** Lower bound of the commit-panel drag. */
export const COMMIT_WIDTH_MIN = 240
/** Upper bound of the commit-panel drag. */
export const COMMIT_WIDTH_MAX = 520
/** Default commit-panel width. */
export const COMMIT_WIDTH_DEFAULT = 320
/** Lower bound of the log-area drag. */
export const LOG_HEIGHT_MIN = 140
/** Default log-area height. */
export const LOG_HEIGHT_DEFAULT = 320

/** The values a Session starts with before it recorded anything. */
export const DEFAULT_PREFS: GitRightbarPrefs = {
  commitOpen: null,
  commitWidth: COMMIT_WIDTH_DEFAULT,
  logHeight: LOG_HEIGHT_DEFAULT,
  diffMode: 'auto',
}

/** Browser-local key prefix; the Session id follows it. */
const KEY_PREFIX = 'dsh.git-window.rightbar.'

/** The storage key for one Session. */
export function prefsKey(sessionId: string): string {
  return KEY_PREFIX + sessionId
}

/** Clamp a number into a range, falling back when it is not finite. */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(min, Math.round(value)), max)
}

/** Validate one stored document; any malformed field falls back on its own. */
function sanitize(value: unknown): GitRightbarPrefs {
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFS
  const record = value as Record<string, unknown>
  const commitOpen = record.commitOpen === true ? true : record.commitOpen === false ? false : null
  const diffMode = record.diffMode === 'unified' || record.diffMode === 'side' ? record.diffMode : 'auto'
  return {
    commitOpen,
    commitWidth: clamp(record.commitWidth, COMMIT_WIDTH_MIN, COMMIT_WIDTH_MAX, COMMIT_WIDTH_DEFAULT),
    logHeight: clamp(record.logHeight, LOG_HEIGHT_MIN, 2_000, LOG_HEIGHT_DEFAULT),
    diffMode,
  }
}

/** Read one Session's preferences; a missing or denied store answers defaults. */
export function readPrefs(sessionId: string): GitRightbarPrefs {
  if (typeof localStorage === 'undefined') return DEFAULT_PREFS
  try {
    const raw = localStorage.getItem(prefsKey(sessionId))
    if (raw === null) return DEFAULT_PREFS
    return sanitize(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_PREFS
  }
}

/** Write one Session's preferences; denial is not an error. */
export function writePrefs(sessionId: string, prefs: GitRightbarPrefs): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(prefsKey(sessionId), JSON.stringify(prefs))
  } catch {
    // Storage can be denied (private mode, blocked site data); the page still works.
  }
}
