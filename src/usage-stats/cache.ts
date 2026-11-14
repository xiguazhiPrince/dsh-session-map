/**
 * Persistent per-log cache of usage summaries.
 *
 * Folding every Session log takes several seconds of zstd decoding, while a
 * typical refresh changes one or two logs. The cache keeps each log's
 * {@link SessionSummary} (or the reason it could not be counted) keyed by its
 * path relative to the Sessions root, and validates an entry by the file's
 * size and mtime — the classic make-style freshness check. A log appended to,
 * migrated, or rewritten changes at least one of the two. The counting-rule
 * version is part of the file, so a rule change discards every entry once.
 *
 * The file lives next to the fork ledger, `$DSH_HOME/session-map/`, and is
 * written atomically (same-directory temp file + rename). Anything unreadable
 * degrades to an empty cache: the cache only ever saves time.
 *
 * @module dsh-session-map/usage-stats/cache
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { SUMMARY_RULES_VERSION, table, type Bucket, type SessionSummary } from './model'

/** One cached log. */
export interface CacheEntry {
  readonly size: number
  readonly mtimeMs: number
  /** The fold, or null when the log could not be counted. */
  readonly summary: SessionSummary | null
  /** Why the log could not be counted. */
  readonly reason?: string | undefined
}

/** The cache file. */
export interface UsageCacheFile {
  readonly rules: number
  readonly entries: Record<string, CacheEntry>
}

/**
 * Resolve the DSH home the way the product does: a set, non-blank `DSH_HOME`
 * wins over `<home>/.dsh`.
 * @param env - environment to read.
 * @param home - OS home directory.
 * @returns absolute DSH home.
 */
export function resolveDshHome(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const override = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return override === '' ? resolve(join(home, '.dsh')) : resolve(override)
}

/** Default cache file under one DSH home. */
export function defaultCachePath(dshHome: string): string {
  return join(dshHome, 'session-map', `usage-stats.v${String(SUMMARY_RULES_VERSION)}.json`)
}

/** Whether one parsed value looks like a cache entry. */
function isEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  if (typeof entry.size !== 'number' || typeof entry.mtimeMs !== 'number') return false
  if (entry.summary === null) return typeof entry.reason === 'string'
  const summary = entry.summary as Record<string, unknown> | undefined
  if (typeof summary !== 'object' || summary === null) return false
  if (typeof summary.id !== 'string' || typeof summary.cwd !== 'string' || typeof summary.createdAt !== 'number') return false
  if (summary.origin !== 'root' && summary.origin !== 'subagent') return false
  if (typeof summary.buckets !== 'object' || summary.buckets === null) return false
  return Object.values(summary.buckets).every(isBucket)
}

/** Counter fields every cached bucket carries. */
const BUCKET_NUMBERS = [
  'added', 'removed', 'editLines', 'writeLines', 'turns', 'turnErrors', 'turnAborted', 'activeMs',
  'userMessages', 'steps', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',
  'toolCalls', 'toolFailures',
] as const

/** Whether one cached bucket has every counter and table. */
function isBucket(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const bucket = value as Record<string, unknown>
  for (const field of BUCKET_NUMBERS) if (typeof bucket[field] !== 'number') return false
  for (const field of ['models', 'tools', 'exts'] as const) {
    const table = bucket[field]
    if (typeof table !== 'object' || table === null || Array.isArray(table)) return false
  }
  const models = bucket.models as Record<string, unknown>
  return Object.values(models).every(counter =>
    typeof counter === 'object' && counter !== null && Array.isArray((counter as { providers?: unknown }).providers))
}

/**
 * Copy a parsed entry's name-keyed tables into prototype-less ones. JSON.parse
 * keeps `__proto__` as an own key, but the aggregator writes into these tables
 * and must never meet an inherited one.
 */
function rehome(entry: CacheEntry): CacheEntry {
  if (entry.summary === null) return entry
  const buckets = table<Bucket>()
  for (const [key, bucket] of Object.entries(entry.summary.buckets)) {
    buckets[key] = {
      ...bucket,
      models: Object.assign(table<Bucket['models'][string]>(), bucket.models),
      tools: Object.assign(table<Bucket['tools'][string]>(), bucket.tools),
      exts: Object.assign(table<Bucket['exts'][string]>(), bucket.exts),
    }
  }
  return { ...entry, summary: { ...entry.summary, buckets } }
}

/**
 * Load the cache; anything unreadable, foreign, or from older rules is empty.
 * @param path - cache file.
 * @returns valid entries by relative log path.
 */
export async function loadUsageCache(path: string): Promise<Map<string, CacheEntry>> {
  const entries = new Map<string, CacheEntry>()
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return entries
  }
  if (typeof parsed !== 'object' || parsed === null) return entries
  const file = parsed as { rules?: unknown; entries?: unknown }
  if (file.rules !== SUMMARY_RULES_VERSION || typeof file.entries !== 'object' || file.entries === null) return entries
  for (const [rel, entry] of Object.entries(file.entries as Record<string, unknown>)) {
    if (isEntry(entry)) entries.set(rel, rehome(entry))
  }
  return entries
}

/**
 * Write the cache atomically.
 * @param path - cache file.
 * @param entries - entries by relative log path.
 */
export async function saveUsageCache(path: string, entries: ReadonlyMap<string, CacheEntry>): Promise<void> {
  const file: UsageCacheFile = { rules: SUMMARY_RULES_VERSION, entries: Object.fromEntries(entries) }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${String(process.pid)}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(file), { mode: 0o600 })
    await rename(temp, path)
  } catch (error: unknown) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}
