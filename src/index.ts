/**
 * Host half of the `dsh-session-map` bundle.
 *
 * The Session map is browser-first; the host behavior this bundle owns serves
 * the Conversation → Instructions tab, its two Settings pages, and the one
 * header-only seed read the map needs to orient fork families:
 *
 * - Settings → Clone from Git: the clone routes and the Workspace registration
 *   they call, installed where the profile composes `webServer`, `subprocess`
 *   and `workspaceRegistry`.
 * - Settings → Skills: one read route over the skill and Workspace registries,
 *   installed wherever a web server exists. Both registries stay optional and
 *   are read per request, so a thin composition narrows the answer instead of
 *   half-loading this plugin.
 * - Conversation → Instructions: one read/write route family over the AGENTS.md
 *   instruction chain, installed wherever a web server exists. The Session
 *   query and working-directory services stay optional and are read per
 *   request, so a composition without them reports that plainly instead of
 *   failing at apply time.
 * - Conversation → Session map: one read-only route over the Session headers,
 *   answering each listed Session's creation time so the canvas can tell a fork
 *   source from its children, plus the fork ledger routes the browser half
 *   reports observed `sessions.fork` calls to. The map itself keeps working
 *   without either.
 *
 * @module dsh-session-map/host
 */
import type { Context } from '@deepseek-ai/cordis'
import { installAgentInstructionsHost } from './agent-instructions/host'
import { installGitWorkspaceHost } from './git-workspace/host'
import { installSessionForkHost } from './session-map/host-forks'
import { installSessionLineageHost } from './session-map/host-lineage'
import { installSkillCatalogHost } from './skill-catalog/host'

/** Host plugin body: expose the settings and instruction routes. */
export function apply(ctx: Context): void {
  ctx.inject(['webServer', 'subprocess', 'workspaceRegistry'], (scope) => {
    installGitWorkspaceHost(scope)
  })

  // The Skills, Instructions, and Session-map seed routes need only the web
  // server: the registries and Session services they read are optional
  // capabilities resolved on each request, so this registration stays valid in a
  // composition that mounts none.
  ctx.inject(['webServer'], (scope) => {
    installSkillCatalogHost(scope)
    installAgentInstructionsHost(scope)
    installSessionLineageHost(scope)
    installSessionForkHost(scope)
  })
}
