/**
 * Host half of the `dsh-session-map` bundle.
 *
 * The Session map itself is browser-only; the host behavior this bundle owns
 * serves its two Settings pages:
 *
 * - Settings → Clone from Git: the clone routes and the Workspace registration
 *   they call, installed where the profile composes `webServer`, `subprocess`
 *   and `workspaceRegistry`.
 * - Settings → Skills: one read route over the skill and Workspace registries,
 *   installed wherever a web server exists. Both registries stay optional and
 *   are read per request, so a thin composition narrows the answer instead of
 *   half-loading this plugin.
 *
 * @module dsh-session-map/host
 */
import type { Context } from '@deepseek-ai/cordis'
import { installGitWorkspaceHost } from './git-workspace/host'
import { installSkillCatalogHost } from './skill-catalog/host'

/** Host plugin body: expose the settings routes. */
export function apply(ctx: Context): void {
  ctx.inject(['webServer', 'subprocess', 'workspaceRegistry'], (scope) => {
    installGitWorkspaceHost(scope)
  })

  // The Skills route needs only the web server: `skills` and `workspaceRegistry`
  // are optional capabilities resolved on each read, so this registration stays
  // valid in a composition that mounts neither.
  ctx.inject(['webServer'], (scope) => {
    installSkillCatalogHost(scope)
  })
}
