/**
 * Fake Host plumbing for route tests: one web-server registry, one workspace
 * registry, and an in-process request runner that keeps the production trust
 * gate (`isTrustedRequest`) on the path.
 *
 * @module dsh-session-map/git-workspace/testing/fake-host
 */
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { FakeSubprocess } from './fake-subprocess'

/** One route registration the Host installs. */
export interface FakeRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (request: unknown, response: unknown) => void | Promise<void>
}

/** The web-server face the Host reads. */
export class FakeWebServer {
  readonly routes: FakeRoute[] = []

  register(route: FakeRoute): () => void {
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
    }
  }

  getOrigin(): string {
    return 'http://127.0.0.1:3080'
  }

  /** Match a request with exact-first, then longest-prefix semantics. */
  match(pathname: string): FakeRoute | undefined {
    const exact = this.routes.find(route => route.kind === 'exact' && route.path === pathname)
    if (exact !== undefined) return exact
    let best: FakeRoute | undefined
    for (const route of this.routes) {
      if (route.kind !== 'prefix') continue
      if (pathname !== route.path && !pathname.startsWith(`${route.path}/`)) continue
      if (best === undefined || route.path.length > best.path.length) best = route
    }
    return best
  }
}

/** One fake Workspace entity. */
export interface FakeWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
}

/** The durable Workspace registry face the Host reads. */
export class FakeWorkspaceRegistry {
  private readonly rows: FakeWorkspace[]

  constructor(rows: readonly FakeWorkspace[]) {
    this.rows = [...rows]
  }

  list(): readonly FakeWorkspace[] {
    return this.rows
  }

  get(id: string): FakeWorkspace | undefined {
    return this.rows.find(row => row.id === id)
  }

  resolveByPath(path: string): Promise<FakeWorkspace | undefined> {
    return Promise.resolve(this.rows.find(row => row.path === path))
  }

  create(path: string, title?: string): Promise<FakeWorkspace> {
    const row: FakeWorkspace = { id: `workspace-${this.rows.length + 1}`, path, title: title ?? path }
    this.rows.push(row)
    return Promise.resolve(row)
  }
}

/** The working-directory fallback the clone page reads. */
export const fakeWorkingDirectory = { defaultDirectory: '/tmp' }

/** Response object that records what the handler wrote. */
class FakeResponse extends EventEmitter {
  statusCode = 0
  headers: Record<string, string | number> = {}
  body = ''
  ended = false

  writeHead(status: number, headers: Readonly<Record<string, string | number>> = {}): this {
    this.statusCode = status
    this.headers = { ...this.headers, ...headers }
    return this
  }

  end(body?: string): this {
    if (body !== undefined) this.body += body
    this.ended = true
    return this
  }
}

/** One request the test issues. */
export interface InvokeOptions {
  readonly method?: 'GET' | 'POST'
  readonly path: string
  readonly body?: unknown
  readonly peer?: string
  readonly host?: string
  readonly origin?: string | undefined
  readonly contentType?: string
}

/** Decoded route result. */
export interface InvokeResult {
  readonly status: number
  readonly headers: Readonly<Record<string, string | number>>
  readonly text: string
  readonly json: unknown
}

/** The fake context surface `host.ts` reads (`get` / `effect`). */
export interface FakeContext {
  get(name: string): unknown
  effect(body: () => unknown, label?: string): unknown
  inject(names: readonly string[], callback: (scope: FakeContext) => void): void
}

/**
 * Build the minimal Cordis-like scope the Host installers use.
 * @param services - service key to fake instance.
 * @returns a scope whose `inject` invokes its callback immediately.
 */
export function createFakeContext(services: Readonly<Record<string, unknown>>): FakeContext {
  const scope: FakeContext = {
    get(name: string): unknown {
      return services[name]
    },
    effect(body: () => unknown): unknown {
      const disposer = body()
      return typeof disposer === 'function' ? disposer : () => undefined
    },
    inject(_names: readonly string[], callback: (scope: FakeContext) => void): void {
      callback(scope)
    },
  }
  return scope
}

/**
 * Invoke one route the Host registered.
 * @param server - the fake web server.
 * @param options - request shape.
 * @returns captured status, headers and decoded JSON.
 */
export async function invokeRoute(server: FakeWebServer, options: InvokeOptions): Promise<InvokeResult> {
  const url = new URL(options.path, 'http://127.0.0.1:3080')
  const route = server.match(url.pathname)
  if (route === undefined) {
    return { status: 404, headers: {}, text: 'no route', json: null }
  }

  const bodyText = options.body === undefined ? '' : JSON.stringify(options.body)
  const request = Readable.from(bodyText === '' ? [] : [Buffer.from(bodyText, 'utf8')]) as unknown as {
    method: string
    url: string
    headers: Record<string, string>
    socket: { remoteAddress: string }
  }
  request.method = options.method ?? 'GET'
  request.url = `${url.pathname}${url.search}`
  request.headers = {
    host: options.host ?? '127.0.0.1:3080',
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.body === undefined ? {} : { 'content-type': options.contentType ?? 'application/json' }),
  }
  request.socket = { remoteAddress: options.peer ?? '127.0.0.1' }

  const response = new FakeResponse()
  await route.handler(request, response)

  let json: unknown = null
  if (response.body !== '') {
    try {
      json = JSON.parse(response.body) as unknown
    } catch {
      json = null
    }
  }
  return { status: response.statusCode, headers: response.headers, text: response.body, json }
}

/** Convenience bundle for route tests. */
export interface HostHarness {
  readonly server: FakeWebServer
  readonly workspaces: FakeWorkspaceRegistry
  readonly subprocess: FakeSubprocess
  readonly ctx: FakeContext
}

/**
 * Build the Host harness over one fake subprocess and one workspace row.
 * @param subprocess - scripted process seam.
 * @param workspacePath - absolute directory the single fake Workspace points at.
 * @returns the harness pieces.
 */
export function createHostHarness(subprocess: FakeSubprocess, workspacePath: string): HostHarness {
  const server = new FakeWebServer()
  const workspaces = new FakeWorkspaceRegistry([{ id: 'workspace-1', path: workspacePath, title: 'repo' }])
  const ctx = createFakeContext({
    webServer: server,
    subprocess,
    workspaceRegistry: workspaces,
    workingDirectory: fakeWorkingDirectory,
  })
  return { server, workspaces, subprocess, ctx }
}
