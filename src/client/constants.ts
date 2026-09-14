/**
 * Session map constants: the two right-sidebar tab type ids, the canvas
 * geometry, and the per-edge-kind stylesheet classes.
 *
 * The type ids carry this package's own namespace rather than the dynamic
 * runtime's `dynamic.` prefix: a tab type's `id` is the key its body registers
 * under in `sidebar.right.pane.tab`, so it has to stay unique across every
 * package that contributes one. The `kind` values are the discriminators
 * `sidebarRight.openTab` names and are deliberately unchanged.
 *
 * @module dsh-session-map/client/constants
 */

/** Kind (the `openTab` discriminator) of the plain Session overview page. */
export const OVERVIEW_KIND = 'session-overview'

/** Tab-type id the overview body registers under. */
export const OVERVIEW_TYPE_ID = 'dsh-session-map.overview'

/** Kind (the `openTab` discriminator) of the fork-tree canvas page. */
export const MAP_KIND = 'session-map'

/** Tab-type id the canvas body registers under. */
export const MAP_TYPE_ID = 'dsh-session-map.map'

/** Width of one Session card, in stage coordinates. */
export const NODE_W = 200

/** Height of one Session card, in stage coordinates. */
export const NODE_H = 46

/** Width one turn bead is drawn at; it also cuts the bead's own preview text. */
export const BEAD_W = 120

/** Height of one turn bead, and of every fold capsule, in stage coordinates. */
export const BEAD_H = 22

/** Horizontal distance between two consecutive beads on one wire. */
export const BEAD_PITCH = 128

/** Gap left between two beads, or between a bead and a capsule. */
export const BEAD_GAP = 8

/** Gap between a Session card's right edge and the first capsule on its wire. */
export const BEAD_LEAD = 22

// The fold capsule that stands in for turns shown somewhere else, or hidden.
/** Width of a line or fold capsule. */
export const MARKER_W = 96

/** Horizontal gap between a Session card and each of its branches. */
export const BRANCH_GAP = 56

/** Vertical distance between two rows of the tree. */
export const ROW = 62

/** Gap subtracted between two sibling trees. */
export const GAP_Y = 16

/** Height reserved above a tree for its caption. */
export const CAPTION_H = 24

/** Gap added between two sibling trees. */
export const TREE_GAP = 36

/** Padding kept inside the stage on every side. */
export const PAD = 28

/** Lowest canvas scale the toolbar and the wheel will reach. */
export const MIN_ZOOM = 0.15

// The scale the toolbar calls 100% and every automatic placement settles on.
/** Canvas scale the toolbar reports as 100%. */
export const BASE_ZOOM = 1.4

// Raw ceiling; 2.8 raw is 200% on the toolbar's scale, the headroom the
// control had before the baseline moved.
/** Highest canvas scale the toolbar and the wheel will reach. */
export const MAX_ZOOM = 2.8

// One wheel line, for the browsers that report wheel deltas in lines.
/** Pixel delta one wheel line stands for. */
export const WHEEL_LINE = 16

// Popovers, used only to keep them inside the panel.
/** Width of the node/bead action popover. */
export const MENU_W = 184

/** Height assumed for the action popover when clamping it inside the panel. */
export const MENU_H = 118

/** Inset the action popover keeps from the panel's edges. */
export const MENU_INSET = 8

/** The three wire kinds the canvas draws, each with its own stroke treatment. */
export type EdgeKind = 'branch' | 'sub' | 'wire'

/** Stylesheet class per wire kind. */
export const EDGE_CLASS: Readonly<Record<EdgeKind, string>> = {
  branch: 'dsm__edge',
  sub: 'dsm__edge dsm__edge--sub',
  wire: 'dsm__edge dsm__edge--wire',
}
