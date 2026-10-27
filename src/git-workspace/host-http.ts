/**
 * Shared HTTP plumbing for the plugin's Host routes: the structural request and
 * response views, the JSON writer, the bounded body reader, and the loopback
 * trust gate every route family runs first.
 *
 * Plugin routes bypass the web server's authenticated document layer, so the
 * trust gate is the only thing between a local page and git on this machine.
 *
 * @module dsh-session-map/git-workspace/host-http
 */

/** The subset of a Node request the routes read. */
export interface RouteRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  /** Real peer connection; the Host header alone is client-controlled. */
  readonly socket?: { readonly remoteAddress?: string } | undefined
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  on(event: 'end', listener: () => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'aborted', listener: () => void): unknown
  on(event: 'error', listener: () => void): unknown
}

/** The subset of a Node response the routes write. */
export interface RouteResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string | number>>): unknown
  end(body?: string): unknown
  /** Present for streaming responses (SSE job progress). */
  write?(chunk: string): unknown
  on(event: 'close', listener: () => void): unknown
}

/** One web-server route registration. */
export interface WebRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (request: RouteRequest, response: RouteResponse) => void | Promise<void>
}

/** The web-server service this plugin registers into. */
export interface WebServerService {
  getOrigin(): string
  register(route: WebRoute): () => void
}

/** Largest JSON request body any route accepts. */
export const MAX_BODY_BYTES = 16 * 1024

/** Host names that only ever identify this machine. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/**
 * Raise and format one JSON response; a closed connection is not an error.
 * @param response - route response.
 * @param status - HTTP status.
 * @param value - JSON body.
 */
export function sendJson(response: RouteResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  try {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': new TextEncoder().encode(body).byteLength,
    })
    response.end(body)
  } catch {
    // The page navigated away or reloaded while a command ran; its response is gone.
  }
}

/**
 * Read one header value.
 * @param request - incoming request.
 * @param name - lower-case header name.
 * @returns the first value, or undefined when absent.
 */
export function headerValue(request: RouteRequest, name: string): string | undefined {
  const value = request.headers[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

/**
 * Whether one connection peer belongs to this machine.
 * @param address - `socket.remoteAddress`.
 * @returns true for IPv4/IPv6 loopback, including mapped IPv4.
 */
export function isLoopbackAddress(address: string): boolean {
  const value = address.toLowerCase()
  if (value.startsWith('::ffff:')) return isLoopbackAddress(value.slice(7))
  return value === '::1' || value === '127.0.0.1' || value.startsWith('127.')
}

/**
 * Whether a request may reach one of this plugin's route families.
 *
 * The socket peer decides first: a LAN or public bind must not let a remote
 * raw-HTTP client spoof a loopback Host header and drive git on this machine.
 * @param request - incoming request.
 * @returns true when the request is same-machine and same-origin.
 */
export function isTrustedRequest(request: RouteRequest): boolean {
  const peer = request.socket?.remoteAddress
  if (peer === undefined || !isLoopbackAddress(peer)) return false

  const host = headerValue(request, 'host')
  if (host === undefined || host === '') return false
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1).replace(/^\[|\]$/g, '').toLowerCase()
    : host.replace(/:\d+$/, '').toLowerCase()
  if (!LOOPBACK_HOSTS.has(hostname)) return false

  const origin = headerValue(request, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Concatenate received request chunks. */
function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const merged = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/** Result of reading a JSON request body. */
export type JsonBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: 400 | 413; readonly message: string }

/**
 * Read a bounded JSON request body. The web server has no body parser, so the
 * route owns the stream.
 * @param request - incoming request.
 * @returns the decoded value, or a rejection message.
 */
export async function readJsonBody(request: RouteRequest): Promise<JsonBodyResult> {
  return await new Promise<JsonBodyResult>((resolve) => {
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    let settled = false
    const settle = (result: JsonBodyResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    request.on('data', (chunk) => {
      if (settled) return
      totalBytes += chunk.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        settle({ ok: false, status: 413, message: 'the request body is too large' })
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      try {
        const text = new TextDecoder().decode(concatChunks(chunks, totalBytes)).trim()
        settle({ ok: true, value: text === '' ? {} : JSON.parse(text) as unknown })
      } catch {
        settle({ ok: false, status: 400, message: 'the request body is not valid JSON' })
      }
    })
    // 'close' is the portable terminal event: an aborted upload may never emit
    // 'end' or the deprecated 'aborted' event on every Node version.
    request.on('close', () => { settle({ ok: false, status: 400, message: 'the request was closed before its body completed' }) })
    request.on('aborted', () => { settle({ ok: false, status: 400, message: 'the request was aborted' }) })
    request.on('error', () => { settle({ ok: false, status: 400, message: 'the request stream failed' }) })
  })
}
