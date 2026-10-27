/**
 * Identifiers for the Git right-column page.
 *
 * The type id carries this package's own namespace (the same convention as the
 * Session map tab types): a tab type's `id` is the key its body registers under
 * in `sidebar.right.pane.tab`, so it has to stay unique across every package
 * that contributes one. The kind is the discriminator `sidebarRight.openTab`
 * names.
 *
 * @module dsh-session-map/git-workspace/window/rightbar/ids
 */

/** Kind (the `openTab` discriminator) of the Git right-column page. */
export const GIT_RIGHTBAR_KIND = 'git-window'

/** Tab-type id the page body registers under. */
export const GIT_RIGHTBAR_TYPE_ID = 'dsh-session-map.git'

/** Session-header launcher id. */
export const GIT_RIGHTBAR_HEADER_ID = 'git-window-launcher'

/** Session-header launcher order (left of the Session map launcher). */
export const GIT_RIGHTBAR_HEADER_ORDER = 41
