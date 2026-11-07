/**
 * Host half of the fork-lineage seed read.
 *
 * Registers one same-origin read route under `/plugin-session-lineage` that
 * answers, for every listed Session, its creation time and seeded flag. The
 * canvas cannot derive a fork direction from the copied turn prefix alone — a
 * shared prefix is symmetric — so it asks here which Session of a family is the
 * oldest.
 *
 * The read is deliberately cheap: `ctx.sessionQuery.listSessions()` lists
 * headers only (no log replay), and a seeded Session's stored header already
 * carries `createdAt` and `isSeeded`. The exact inherited cut is *not* exposed
 * here because body-free records omit it; recovering it would replay every log,
 * which is not a cost a canvas refresh may pay. Creation time alone is enough
 * to make the direction consistent: a Session can only be the source of one
 * created after it.
 *
 * This route only reads. It mirrors the other read-only route families in this
 * package (Skills, Instructions): no loopback gate, because it changes nothing
 * and exposes only identities and timestamps the Session list already shows.
 * Without a Session query service the route answers an empty list, and the
 * canvas keeps its direction-free choice.
 *
 * @module dsh-session-map/session-map/host-lineage
 */
import type { Context } from '@deepseek-ai/cordis'
import { errorMessage } from '../git-workspace/git'
import {
  sendJson,
  type RouteRequest,
  type RouteResponse,
  type WebServerService,
} from '../git-workspace/host-http'
import {
  SESSION_LINEAGE_ROUTE,
  type SessionLineageEnvelope,
  type SessionLineageRow,
} from './lineage'

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/** One body-free Session record as the query service lists it. */
export interface SessionQueryRecord {
  readonly header?: {
    readonly id?: unknown
    readonly createdAt?: unknown
    readonly isSeeded?: unknown
  } | undefined
}

/** The Session query service this Host plugin reads. */
export interface SessionQueryService {
  listSessions(signal?: AbortSignal): Promise<readonly SessionQueryRecord[]>
}

/**
 * Read one optional service through the context's untyped lookup.
 * @param ctx - Host context.
 * @param name - service key.
 * @returns the service, or undefined when the composition does not provide it.
 */
function lookup<T>(ctx: Context, name: string): T | undefined {
  const found = (ctx as unknown as ServiceLocator).get(name)
  return found === undefined ? undefined : found as T
}

/**
 * Turn one header-only listing into the route body.
 *
 * Rows without a usable id or creation time are dropped rather than guessed:
 * the canvas treats a missing row exactly like a missing family member.
 * @param service - the Session query service, when the composition provides one.
 * @returns the envelope the browser reads.
 */
export async function readSessionLineage(
  service: SessionQueryService | undefined,
): Promise<SessionLineageEnvelope> {
  if (service === undefined) return { ok: true, sessions: [] }
  const records = await service.listSessions()
  const sessions: SessionLineageRow[] = []
  for (const record of records) {
    const header = record?.header
    if (header === undefined) continue
    const id = header.id
    const createdAt = header.createdAt
    if (typeof id !== 'string' || id === '') continue
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) continue
    sessions.push({ id, createdAt, isSeeded: header.isSeeded === true })
  }
  return { ok: true, sessions }
}

/**
 * Install the fork-lineage seed route.
 *
 * Call this from a context that already provides `webServer`; the Session query
 * service stays optional and is resolved on each request, so a thin composition
 * serves an empty answer instead of failing to load.
 * @param ctx - plugin context carrying the web server.
 */
export function installSessionLineageHost(ctx: Context): void {
  const webServer = lookup<WebServerService>(ctx, 'webServer')
  if (webServer === undefined) return

  const handler = async (request: RouteRequest, response: RouteResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const method = (request.method ?? 'GET').toUpperCase()
    if (url.pathname !== `${SESSION_LINEAGE_ROUTE}/state`) {
      sendJson(response, 404, {
        ok: false,
        error: { code: 'not-found', message: `unknown endpoint: ${method} ${url.pathname}` },
      })
      return
    }
    if (method !== 'GET') {
      sendJson(response, 405, {
        ok: false,
        error: { code: 'method-not-allowed', message: 'use GET' },
      })
      return
    }
    try {
      sendJson(response, 200, await readSessionLineage(lookup<SessionQueryService>(ctx, 'sessionQuery')))
    } catch (error: unknown) {
      sendJson(response, 500, {
        ok: false,
        error: { code: 'internal', message: errorMessage(error) },
      })
    }
  }

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: SESSION_LINEAGE_ROUTE, handler }),
    'session-lineage: state route',
  )
}
