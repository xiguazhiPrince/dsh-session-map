/**
 * Host half of the `dsh-session-map` bundle.
 *
 * The Session map itself is browser-only; the host behavior this bundle owns is
 * the Settings → Clone from Git workflow: the clone routes and the Workspace
 * registration they call. They are installed only where the profile composes
 * all three services they need, so a non-web composition keeps the browser
 * bundle addressable without a half-loaded Host plugin.
 *
 * @module dsh-session-map/host
 */
import type { Context } from '@deepseek-ai/cordis'
import { installGitWorkspaceHost } from './git-workspace/host'

/** Host plugin body: expose the Clone-from-Git routes. */
export function apply(ctx: Context): void {
  ctx.inject(['webServer', 'subprocess', 'workspaceRegistry'], (scope) => {
    installGitWorkspaceHost(scope)
  })
}
