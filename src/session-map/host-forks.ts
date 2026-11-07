/**
 * Host half of the fork ledger: persist the `{ child, parent }` edges the
 * browser half observes, and serve them to every later page.
 *
 * The ledger is the plugin's own record, not a Harness one: a current Harness
 * keeps no fork source anywhere, so the only exact evidence is the client
 * `sessions.fork({ sessionId })` call, which the browser half wraps. This route
 * family makes that observation durable and shared:
 *
 * - `GET  /plugin-session-forks/state`  — every edge, pruned against the
 *   Session list so deleted Sessions do not accumulate;
 * - `POST /plugin-session-forks/record` — one observed edge, merged into the
 *   ledger under a serialized read-modify-write.
 *
 * Storage is one JSON file under the DSH home (`$DSH_HOME/session-map/forks.json`
 * by default), written atomically through a same-directory temp file plus
 * rename. The writer path is loopback-gated exactly like the package's other
 * write routes; the read route stays open like the other read routes. A file
 * that is missing, corrupt, or carries foreign rows degrades to "no observed
 * edges" instead of failing a request, because the canvas still has its prefix
 * inference.
 *
 * @module dsh-session-map/session-map/host-forks
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { errorMessage } from '../git-workspace/git'
import {
  isTrustedRequest,
  readJsonBody,
  sendJson,
  type RouteRequest,
  type RouteResponse,
  type WebServerService,
} from '../git-workspace/host-http'
import {
  SESSION_FORK_ROUTE,
  SESSION_FORK_VERSION,
  type SessionForkEnvelope,
  type SessionForkRecord,
  type SessionForkRequest,
} from './forks'

/** Oldest edges dropped when the ledger is rewritten: half a year of forks. */
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000

/** Largest ledger kept; beyond this the oldest edges are dropped. */
const MAX_FORKS = 5000

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/** One body-free Session record the pruning read needs. */
interface SessionQueryRecordLike {
  readonly header?: { readonly id?: unknown } | undefined
}

/** The Session query service this Host plugin reads, when composed. */
export interface SessionQueryService {
  listSessions(signal?: AbortSignal): Promise<readonly SessionQueryRecordLike[]>
}

/** Install seams a test or a deployment override. */
export interface SessionForkHostOptions {
  /** Exact ledger file; overrides the DSH-home resolution. */
  readonly ledgerPath?: string | undefined
  /** Environment used to resolve `DSH_HOME`. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  /** Home directory used when `DSH_HOME` is unset. */
  readonly home?: string | undefined
}

/**
 * Resolve the ledger file from the DSH home, mirroring the product's own
 * `DSH_HOME` handling: a set, non-blank override wins over `<home>/.dsh`.
 * @param env - environment to read; defaults to `process.env`.
 * @param home - OS home directory; defaults to `os.homedir()`.
 * @returns absolute path of the ledger file.
 */
export function resolveForkLedgerPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const override = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  const dshHome = override === '' ? resolve(join(home, '.dsh')) : resolve(override)
  return join(dshHome, 'session-map', 'forks.json')
}

/**
 * Read one ledger file, dropping unreadable or malformed rows.
 * @param path - ledger file path.
 * @returns the valid records, in file order.
 */
export async function loadForkLedger(path: string): Promise<readonly SessionForkRecord[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const forks: unknown = typeof parsed === 'object' && parsed !== null
    ? (parsed as { readonly forks?: unknown }).forks
    : undefined
  if (!Array.isArray(forks)) return []
  const records: SessionForkRecord[] = []
  for (const candidate of forks) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const childId: unknown = (candidate as { readonly childId?: unknown }).childId
    const parentId: unknown = (candidate as { readonly parentId?: unknown }).parentId
    const recordedAt: unknown = (candidate as { readonly recordedAt?: unknown }).recordedAt
    const atSeq: unknown = (candidate as { readonly atSeq?: unknown }).atSeq
    if (typeof childId !== 'string' || childId === '') continue
    if (typeof parentId !== 'string' || parentId === '' || parentId === childId) continue
    if (typeof recordedAt !== 'number' || !Number.isFinite(recordedAt)) continue
    if (atSeq !== undefined && (typeof atSeq !== 'number' || !Number.isInteger(atSeq) || atSeq < 0)) continue
    records.push({
      childId,
      parentId,
      recordedAt,
      ...(atSeq === undefined ? {} : { atSeq }),
    })
  }
  return records
}

/**
 * Write one ledger file atomically: same-directory temp file, then rename.
 * @param path - ledger file path.
 * @param forks - complete record set to publish.
 */
export async function saveForkLedger(path: string, forks: readonly SessionForkRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const body = JSON.stringify({ version: SESSION_FORK_VERSION, forks }, null, 2) + '\n'
  const temp = `${path}.${String(process.pid)}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, body, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/**
 * Merge one observed edge into a record set, applying retention and the size
 * cap. A newer observation of the same child replaces the older one.
 * @param current - records already on disk.
 * @param next - the edge just observed.
 * @param now - clock for retention; defaults to the current time.
 * @returns the complete record set to write.
 */
export function mergeForkRecords(
  current: readonly SessionForkRecord[],
  next: SessionForkRecord,
  now: number = Date.now(),
): readonly SessionForkRecord[] {
  const byChild = new Map<string, SessionForkRecord>()
  for (const record of current) {
    if (now - record.recordedAt > RETENTION_MS) continue
    byChild.set(record.childId, record)
  }
  byChild.set(next.childId, next)
  const merged = [...byChild.values()].sort((left, right) => left.recordedAt - right.recordedAt)
  return merged.length > MAX_FORKS ? merged.slice(merged.length - MAX_FORKS) : merged
}

/**
 * Drop edges whose child or parent is no longer listed.
 * @param records - ledger records.
 * @param knownIds - currently listed Session ids.
 * @returns the records that still have both endpoints listed.
 */
export function pruneForkRecords(
  records: readonly SessionForkRecord[],
  knownIds: ReadonlySet<string>,
): readonly SessionForkRecord[] {
  return records.filter(record => knownIds.has(record.childId) && knownIds.has(record.parentId))
}

/**
 * Validate one report body; the browser half is the only writer.
 * @param value - parsed JSON body.
 * @returns the request, or undefined when the body is not a fork report.
 */
function parseForkRequest(value: unknown): SessionForkRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const childId: unknown = (value as { readonly childId?: unknown }).childId
  const parentId: unknown = (value as { readonly parentId?: unknown }).parentId
  const atSeq: unknown = (value as { readonly atSeq?: unknown }).atSeq
  if (typeof childId !== 'string' || childId === '') return undefined
  if (typeof parentId !== 'string' || parentId === '' || parentId === childId) return undefined
  if (atSeq !== undefined && (typeof atSeq !== 'number' || !Number.isInteger(atSeq) || atSeq < 0)) return undefined
  return { childId, parentId, ...(atSeq === undefined ? {} : { atSeq }) }
}

/**
 * Look up one optional service through the context's untyped lookup.
 * @param ctx - Host context.
 * @param name - service key.
 * @returns the service, or undefined when the composition does not provide it.
 */
function lookup<T>(ctx: Context, name: string): T | undefined {
  const found = (ctx as unknown as ServiceLocator).get(name)
  return found === undefined ? undefined : found as T
}

/**
 * Install the fork-ledger route family.
 *
 * Call this from a context that already provides `webServer`; the Session query
 * service stays optional (it only prunes deleted Sessions) and is resolved per
 * request.
 * @param ctx - plugin context carrying the web server.
 * @param options - install seams for tests and non-default home layouts.
 */
export function installSessionForkHost(ctx: Context, options: SessionForkHostOptions = {}): void {
  const webServer = lookup<WebServerService>(ctx, 'webServer')
  if (webServer === undefined) return
  const ledgerPath = options.ledgerPath ?? resolveForkLedgerPath(options.env, options.home ?? homedir())

  // One serialized read-modify-write chain: two tabs may report at once, and a
  // lost update would drop an observed edge.
  let writes: Promise<void> = Promise.resolve()
  const append = (record: SessionForkRecord): Promise<void> => {
    const run = writes.then(async () => {
      const current = await loadForkLedger(ledgerPath)
      await saveForkLedger(ledgerPath, mergeForkRecords(current, record))
    })
    writes = run.catch(() => {})
    return run
  }

  const readState = async (): Promise<SessionForkEnvelope> => {
    let records = await loadForkLedger(ledgerPath)
    const query = lookup<SessionQueryService>(ctx, 'sessionQuery')
    if (query !== undefined) {
      try {
        const listed = await query.listSessions()
        const knownIds = new Set<string>()
        for (const record of listed) {
          const id = record?.header?.id
          if (typeof id === 'string' && id !== '') knownIds.add(id)
        }
        if (knownIds.size > 0) records = pruneForkRecords(records, knownIds)
      } catch {
        // A failed listing only costs the pruning; the saved edges stay served.
      }
    }
    return { ok: true, version: SESSION_FORK_VERSION, forks: records }
  }

  const handler = async (request: RouteRequest, response: RouteResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const method = (request.method ?? 'GET').toUpperCase()

      if (url.pathname === `${SESSION_FORK_ROUTE}/state`) {
        if (method !== 'GET') {
          sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use GET' } })
          return
        }
        sendJson(response, 200, await readState())
        return
      }

      if (url.pathname === `${SESSION_FORK_ROUTE}/record`) {
        if (method !== 'POST') {
          sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use POST' } })
          return
        }
        // The browser half is the only writer, and this route mutates the
        // plugin's durable ledger: keep it on this machine like the Git routes.
        if (!isTrustedRequest(request)) {
          sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'same-machine requests only' } })
          return
        }
        const body = await readJsonBody(request)
        if (!body.ok) {
          sendJson(response, body.status, { ok: false, error: { code: 'invalid-request', message: body.message } })
          return
        }
        const report = parseForkRequest(body.value)
        if (report === undefined) {
          sendJson(response, 400, { ok: false, error: { code: 'invalid-request', message: 'not a fork report' } })
          return
        }
        await append({ ...report, recordedAt: Date.now() })
        sendJson(response, 200, { ok: true, version: SESSION_FORK_VERSION, childId: report.childId })
        return
      }

      sendJson(response, 404, {
        ok: false,
        error: { code: 'not-found', message: `unknown endpoint: ${method} ${url.pathname}` },
      })
    } catch (error: unknown) {
      sendJson(response, 500, {
        ok: false,
        error: { code: 'internal', message: errorMessage(error) },
      })
    }
  }

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: SESSION_FORK_ROUTE, handler }),
    'session-forks: ledger routes',
  )
}
