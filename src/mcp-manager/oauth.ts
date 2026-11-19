/**
 * MCP manager — remote-server OAuth (authorization code + PKCE, loopback callback).
 *
 * The product mcp-client only accepts static headers, so this helper obtains a
 * token and hands the Authorization header back to the Host, which writes it
 * into the patch row. Client records live under
 * `$DSH_HOME/storages/session-map/mcp-oauth.json`.
 *
 * Ported from the dsh-mcp-console reference into typed ESM; discovery and PKCE
 * behaviour stay the same so Atlassian-style MCP servers keep working.
 *
 * @module dsh-session-map/mcp-manager/oauth
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname } from 'node:path'

/** Fetch-compatible callable used by discovery and token exchange. */
export type FetchLike = typeof fetch

/** OAuth authorization-server metadata (RFC 8414 / OIDC). */
export interface OAuthMetadata {
  readonly issuer?: string
  readonly authorization_endpoint?: string
  readonly token_endpoint: string
  readonly registration_endpoint?: string
  readonly scopes_supported?: readonly string[]
  readonly [key: string]: unknown
}

/** RFC 9728 protected-resource metadata. */
export interface ProtectedResourceMetadata {
  readonly resource: string
  readonly authorization_servers: readonly string[]
  readonly scopes_supported?: readonly string[]
  readonly [key: string]: unknown
}

/** Resolved discovery used to start one login. */
export interface ResolvedOAuth {
  readonly metadata: OAuthMetadata
  readonly resource: string
  readonly scopes: readonly string[]
}

/** One dynamically-registered client cached by serverName|redirectUri. */
export interface OAuthClientRecord {
  readonly clientId: string
  readonly serverUrl: string
  readonly at: number
}

/** One obtained-token record keyed by serverName. */
export interface OAuthServerRecord {
  readonly clientId: string
  readonly serverUrl: string
  readonly tokenEndpoint: string
  readonly tokenType?: string
  readonly accessToken: string
  readonly expiresIn?: number
  readonly obtainedAt: number
}

/** On-disk OAuth store shape. */
export interface OAuthStore {
  readonly version: 1
  clients: Record<string, OAuthClientRecord>
  servers: Record<string, OAuthServerRecord>
}

/** PKCE verifier + S256 challenge. */
export interface PkcePair {
  readonly verifier: string
  readonly challenge: string
}

/** Loopback callback listener waiting for one authorization code. */
export interface LoopbackServer {
  readonly redirectUri: string
  waitForCode(): Promise<{ readonly code: string }>
  close(): Promise<void>
}

/** Token response from the authorization server. */
export interface OAuthTokens {
  readonly access_token: string
  readonly token_type?: string
  readonly expires_in?: number
  readonly refresh_token?: string
  readonly [key: string]: unknown
}

/** Discovery answers change rarely; keep them so a login click is cheap. */
const DISCOVERY_TTL_MS = 600_000
const DISCOVERY = new Map<string, { readonly at: number; readonly value: ResolvedOAuth | undefined }>()

/**
 * Normalize an MCP server URL: require a scheme, drop a trailing slash.
 * @param url - raw URL from the patch row.
 */
export function normalizeServerUrl(url: unknown): string {
  let value = String(url ?? '').trim()
  if (value === '') throw new Error('缺少服务器 URL')
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  return value.replace(/\/+$/, '')
}

/**
 * Prefer MCP agent-interface scopes when a resource advertises both classic
 * REST scopes and agent ones (Atlassian pattern).
 * @param scopes - scopes_supported from discovery.
 */
export function pickScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes) || scopes.length === 0) return []
  const all = scopes.filter((scope): scope is string => typeof scope === 'string')
  const agent = all.filter((scope) => scope.endsWith(':agent-interface'))
  if (agent.length === 0) return all
  const basics = ['offline_access', 'read:me', 'read:account', 'email'].filter((scope) =>
    all.includes(scope),
  )
  return basics.concat(agent)
}

/**
 * Clear the in-memory discovery cache (tests).
 */
export function clearDiscoveryCache(): void {
  DISCOVERY.clear()
}

/**
 * Fetch JSON from one URL when the response is OK and object-shaped.
 * @param url - absolute URL.
 * @param fetchImpl - fetch implementation.
 */
async function fetchJsonObject(
  url: string,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
    if (response === undefined || response === null || response.ok !== true) return undefined
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
    return body as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Discover authorization-server metadata at the endpoint, then its origin.
 * @param serverUrl - MCP HTTP endpoint.
 * @param fetchImpl - fetch implementation.
 */
export async function discoverMetadata(
  serverUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<OAuthMetadata | undefined> {
  const base = normalizeServerUrl(serverUrl)
  let origin = ''
  try {
    origin = new URL(base).origin
  } catch {
    origin = ''
  }
  const bases = origin !== '' && origin !== base ? [base, origin] : [base]
  for (const candidate of bases) {
    for (const suffix of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/openid-configuration',
    ] as const) {
      const body = await fetchJsonObject(`${candidate}${suffix}`, fetchImpl)
      if (body !== undefined && typeof body.token_endpoint === 'string') {
        return body as OAuthMetadata
      }
    }
  }
  return undefined
}

/**
 * Discover RFC 9728 protected-resource metadata for one MCP endpoint.
 * @param serverUrl - MCP HTTP endpoint.
 * @param fetchImpl - fetch implementation.
 */
export async function discoverProtectedResource(
  serverUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProtectedResourceMetadata | undefined> {
  const base = normalizeServerUrl(serverUrl)
  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    return undefined
  }
  const origin = parsed.origin
  const path = parsed.pathname.replace(/\/+$/, '')
  const candidates: string[] = []
  if (path !== '' && path !== '/') {
    candidates.push(`${origin}/.well-known/oauth-protected-resource${path}`)
  }
  candidates.push(`${origin}/.well-known/oauth-protected-resource`)
  candidates.push(`${base}/.well-known/oauth-protected-resource`)
  for (const url of candidates) {
    const body = await fetchJsonObject(url, fetchImpl)
    if (
      body !== undefined
      && typeof body.resource === 'string'
      && Array.isArray(body.authorization_servers)
      && body.authorization_servers.length > 0
    ) {
      return body as unknown as ProtectedResourceMetadata
    }
  }
  return undefined
}

/**
 * Discover authorization-server metadata for one issuer URL.
 * @param issuer - authorization server issuer.
 * @param fetchImpl - fetch implementation.
 */
export async function discoverAuthorizationServer(
  issuer: string,
  fetchImpl: FetchLike = fetch,
): Promise<OAuthMetadata | undefined> {
  let parsed: URL
  try {
    parsed = new URL(issuer)
  } catch {
    return undefined
  }
  const origin = parsed.origin
  const path = parsed.pathname.replace(/\/+$/, '')
  const root = issuer.replace(/\/+$/, '')
  const candidates: string[] = []
  if (path !== '' && path !== '/') {
    candidates.push(`${origin}/.well-known/oauth-authorization-server${path}`)
    candidates.push(`${root}/.well-known/oauth-authorization-server`)
    candidates.push(`${origin}/.well-known/openid-configuration${path}`)
    candidates.push(`${root}/.well-known/openid-configuration`)
  } else {
    candidates.push(`${origin}/.well-known/oauth-authorization-server`)
    candidates.push(`${origin}/.well-known/openid-configuration`)
  }
  for (const url of candidates) {
    const body = await fetchJsonObject(url, fetchImpl)
    if (body !== undefined && typeof body.token_endpoint === 'string') {
      return body as OAuthMetadata
    }
  }
  return undefined
}

/**
 * Resolve OAuth for one MCP URL without using the discovery cache.
 * @param serverUrl - MCP HTTP endpoint.
 * @param fetchImpl - fetch implementation.
 */
async function resolveOAuthUncached(
  serverUrl: string,
  fetchImpl: FetchLike,
): Promise<ResolvedOAuth | undefined> {
  const prm = await discoverProtectedResource(serverUrl, fetchImpl)
  if (prm !== undefined) {
    for (const issuer of prm.authorization_servers) {
      const metadata = await discoverAuthorizationServer(issuer, fetchImpl)
      if (metadata !== undefined) {
        return {
          metadata,
          resource: prm.resource,
          scopes: pickScopes(prm.scopes_supported),
        }
      }
    }
  }
  const metadata = await discoverMetadata(serverUrl, fetchImpl)
  if (metadata === undefined) return undefined
  return {
    metadata,
    resource: normalizeServerUrl(serverUrl),
    scopes: pickScopes(metadata.scopes_supported),
  }
}

/**
 * Resolve OAuth discovery for one MCP URL, with a short in-memory cache.
 * @param serverUrl - MCP HTTP endpoint.
 * @param fetchImpl - fetch implementation.
 */
export async function resolveOAuth(
  serverUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<ResolvedOAuth | undefined> {
  const cacheKey = normalizeServerUrl(serverUrl)
  const cached = DISCOVERY.get(cacheKey)
  if (cached !== undefined && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value
  const resolved = await resolveOAuthUncached(serverUrl, fetchImpl)
  DISCOVERY.set(cacheKey, { at: Date.now(), value: resolved })
  return resolved
}

/**
 * Load the OAuth store from disk, or an empty store when absent.
 * @param file - absolute store path.
 */
export async function loadStore(file: string): Promise<OAuthStore> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      return {
        version: 1,
        servers: isRecord(record.servers)
          ? (record.servers as Record<string, OAuthServerRecord>)
          : {},
        clients: isRecord(record.clients)
          ? (record.clients as Record<string, OAuthClientRecord>)
          : {},
      }
    }
  } catch {
    // Absent or corrupt store → start empty.
  }
  return { version: 1, servers: {}, clients: {} }
}

/**
 * Persist the OAuth store atomically enough for this surface (mkdir + write).
 * @param file - absolute store path.
 * @param store - store to write.
 */
export async function saveStore(file: string, store: OAuthStore): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(
    file,
    `${JSON.stringify({
      version: 1,
      servers: store.servers ?? {},
      clients: store.clients ?? {},
    }, null, 2)}\n`,
    'utf8',
  )
}

/** Whether a value is a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Create a PKCE verifier and S256 challenge.
 */
export function createPkce(): PkcePair {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * Dynamically register a public client when the AS supports it.
 * @param metadata - authorization-server metadata.
 * @param redirectUri - loopback redirect URI.
 * @param fetchImpl - fetch implementation.
 */
export async function registerClient(
  metadata: OAuthMetadata,
  redirectUri: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ readonly client_id: string } | undefined> {
  const endpoint = metadata.registration_endpoint
  if (typeof endpoint !== 'string' || endpoint === '') return undefined
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'DSH Session Map MCP',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (response === undefined || response === null || response.ok !== true) {
    throw new Error(`动态客户端注册失败（HTTP ${String(response?.status ?? '?')}）`)
  }
  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.client_id !== 'string') {
    throw new Error('动态客户端注册返回里没有 client_id')
  }
  return { client_id: body.client_id }
}

/**
 * Build the browser authorization URL with PKCE + optional resource.
 * @param metadata - authorization-server metadata.
 * @param clientId - OAuth client id.
 * @param redirectUri - loopback redirect URI.
 * @param challenge - PKCE challenge.
 * @param state - CSRF state.
 * @param scope - space-delimited scope string.
 * @param resource - RFC 8707 resource indicator.
 */
export function buildAuthorizationUrl(
  metadata: OAuthMetadata,
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string,
  scope: string | undefined,
  resource: string | undefined,
): string {
  const endpoint = metadata.authorization_endpoint
  if (typeof endpoint !== 'string' || endpoint === '') {
    throw new Error('发现文档里没有 authorization_endpoint')
  }
  const url = new URL(endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  const effectiveScope = scope
    ?? (Array.isArray(metadata.scopes_supported)
      ? metadata.scopes_supported.join(' ')
      : undefined)
  if (typeof effectiveScope === 'string' && effectiveScope !== '') {
    url.searchParams.set('scope', effectiveScope)
  }
  // offline_access (refresh token) is only granted with prompt=consent on OIDC.
  if (typeof effectiveScope === 'string' && effectiveScope.includes('offline_access')) {
    url.searchParams.append('prompt', 'consent')
  }
  if (typeof resource === 'string' && resource !== '') {
    url.searchParams.set('resource', resource)
  }
  return url.toString()
}

/**
 * Start a one-shot loopback HTTP server that captures the authorization code.
 * @param expectedState - CSRF state the callback must echo.
 * @param timeoutMs - how long to wait for the browser callback.
 * @param preferredPort - try this port first so a registered client can be reused.
 */
export async function startLoopbackServer(
  expectedState: string,
  timeoutMs = 300_000,
  preferredPort = 0,
): Promise<LoopbackServer> {
  const listen = (port: number): Promise<LoopbackServer> =>
    new Promise<LoopbackServer>((resolveOuter, rejectOuter) => {
      let settle!: (value: { readonly code: string } | Error) => void
      const outcome = new Promise<{ readonly code: string }>((resolve, reject) => {
        settle = (value) => {
          if (value instanceof Error) reject(value)
          else resolve(value)
        }
      })
      // Keep Node from treating a late rejection as unhandled when the caller
      // never awaits waitForCode (e.g. after close).
      outcome.catch(() => undefined)

      const server: Server = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        if (requestUrl.pathname !== '/callback') {
          response.end('<meta charset=utf-8><p>Not found</p>')
          return
        }
        const error = requestUrl.searchParams.get('error')
        const state = requestUrl.searchParams.get('state')
        if (error !== null) {
          response.end(`<meta charset=utf-8><p>授权被拒绝：${error}</p>`)
          settle(new Error(`授权被拒绝：${error}`))
          return
        }
        if (state !== expectedState) {
          response.end('<meta charset=utf-8><p>state 不匹配，已忽略。</p>')
          settle(new Error('回调 state 不匹配'))
          return
        }
        response.end('<meta charset=utf-8><p>授权成功，可以关闭这个页面。</p>')
        settle({ code: requestUrl.searchParams.get('code') ?? '' })
      })

      const timer = setTimeout(() => settle(new Error('等待授权回调超时')), timeoutMs)
      timer.unref?.()

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (port !== 0) server.close()
        rejectOuter(error)
      })

      server.listen(port, '127.0.0.1', () => {
        const address = server.address()
        const bound = typeof address === 'object' && address !== null ? address.port : 0
        resolveOuter({
          redirectUri: `http://127.0.0.1:${bound}/callback`,
          waitForCode: () => outcome,
          close: () =>
            new Promise<void>((done) => {
              clearTimeout(timer)
              server.close(() => done())
            }),
        })
      })
    })

  if (preferredPort !== 0) {
    try {
      return await listen(preferredPort)
    } catch (error: unknown) {
      const code = isRecord(error) ? error.code : undefined
      if (code !== 'EADDRINUSE') throw error
    }
  }
  return listen(0)
}

/**
 * Exchange an authorization code for tokens.
 * @param metadata - authorization-server metadata.
 * @param clientId - OAuth client id.
 * @param code - authorization code.
 * @param verifier - PKCE verifier.
 * @param redirectUri - loopback redirect URI.
 * @param resource - optional resource indicator.
 * @param fetchImpl - fetch implementation.
 */
export async function exchangeCode(
  metadata: OAuthMetadata,
  clientId: string,
  code: string,
  verifier: string,
  redirectUri: string,
  resource: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })
  if (typeof resource === 'string' && resource !== '') body.set('resource', resource)
  const response = await fetchImpl(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  })
  if (response === undefined || response === null || response.ok !== true) {
    throw new Error(`换令牌失败（HTTP ${String(response?.status ?? '?')}）`)
  }
  const tokens: unknown = await response.json()
  if (!isRecord(tokens) || typeof tokens.access_token !== 'string') {
    throw new Error('令牌响应里没有 access_token')
  }
  return tokens as OAuthTokens
}

/**
 * Format the Authorization header value from a token response.
 * @param tokens - token response.
 */
export function authorizationHeader(tokens: OAuthTokens): string {
  const type = typeof tokens.token_type === 'string' && tokens.token_type !== ''
    ? tokens.token_type
    : 'Bearer'
  return `${type} ${String(tokens.access_token ?? '')}`
}

/**
 * Create a random opaque state string.
 * @param prefix - optional prefix (e.g. `flow-`).
 */
export function createState(prefix = ''): string {
  return `${prefix}${randomUUID().replace(/-/g, '')}`
}
