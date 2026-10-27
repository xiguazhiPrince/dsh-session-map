/**
 * Host half of the `dsh-session-map` bundle.
 *
 * This module owns the route family `/plugin-git-workspace`: one prefix handler
 * applies the loopback trust gate once, then hands the request to the clone
 * routes or to the Git tool window routes.
 *
 * Both registries stay optional and are read per request, so a thin composition
 * narrows the answer instead of half-loading this plugin.
 *
 * @module dsh-session-map/host
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  createCloneHandler,
  type WorkspaceRegistryService,
  type WorkingDirectoryService,
} from './host-clone'
import { createGitWindowHandler } from './host-git'
import {
  isTrustedRequest,
  sendJson,
  type RouteRequest,
  type RouteResponse,
  type WebServerService,
} from './host-http'
import type { SubprocessService } from './host-process'
import { GIT_WORKSPACE_ROUTE } from './route'

export { isTrustedRequest } from './host-http'
export { GIT_WORKSPACE_ROUTE } from './route'

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/**
 * Read one optional service from the global store.
 * @param ctx - the plugin's context.
 * @param name - the service name.
 * @returns the service as the caller's local interface, or `undefined`.
 */
function lookup<T>(ctx: Context, name: string): T | undefined {
  const locator = ctx as unknown as ServiceLocator
  return locator.get(name) as T | undefined
}

/**
 * Install the plugin's Host routes.
 *
 * Call this from a context that provides `webServer`, `subprocess` and
 * `workspaceRegistry`; every registration is owned by an effect.
 * @param ctx - plugin context carrying the three host services.
 */
export function installGitWorkspaceHost(ctx: Context): void {
  const webServer = lookup<WebServerService>(ctx, 'webServer')
  const subprocess = lookup<SubprocessService>(ctx, 'subprocess')
  const workspaces = lookup<WorkspaceRegistryService>(ctx, 'workspaceRegistry')
  if (webServer === undefined || subprocess === undefined || workspaces === undefined) return
  const workingDirectory = lookup<WorkingDirectoryService>(ctx, 'workingDirectory')

  const clone = createCloneHandler({
    subprocess,
    workspaces,
    workingDirectory,
  })
  const gitWindow = createGitWindowHandler({ subprocess, workspaces })

  const handler = async (request: RouteRequest, response: RouteResponse): Promise<void> => {
    try {
      // The route family carries no server-side auth token; only a request from
      // this machine, addressed to a loopback Host, may reach any operation.
      if (!isTrustedRequest(request)) {
        sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'untrusted host' } })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const method = (request.method ?? 'GET').toUpperCase()
      if (await clone(request, response, url, method)) return
      if (await gitWindow(request, response, url, method)) return
      sendJson(response, 404, {
        ok: false,
        error: { code: 'not-found', message: `unknown endpoint: ${method} ${url.pathname}` },
      })
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: GIT_WORKSPACE_ROUTE, handler }),
    'git-workspace: routes',
  )
}
