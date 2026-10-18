/**
 * Session map constants: the two right-sidebar tab type ids, the turn-tree
 * canvas geometry, and the per-edge-kind stylesheet classes.
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

/** Kind (the `openTab` discriminator) of the turn-tree canvas page. */
export const MAP_KIND = 'session-map'

/** Tab-type id the canvas body registers under. */
export const MAP_TYPE_ID = 'dsh-session-map.map'

/** Width of one turn or session-head card, in stage coordinates. */
export const NODE_W = 200

/** Height of one turn or session-head card, in stage coordinates. */
export const NODE_H = 46

/** Distance between a card's far edge and the near edge of any child card. */
export const NODE_GAP = 36

/** Width of one folded-run capsule, in stage coordinates. */
export const MARKER_W = 96

/** Height of one folded-run capsule, and its extent along a downward tree. */
export const MARKER_H = 22

/** Runs longer than this many turns collapse their middle stretch. */
export const RUN_FOLD_MIN = 8

/** Turns kept at the head of a folded run. */
export const RUN_KEEP_HEAD = 2

/** Turns kept at the tail of a folded run. */
export const RUN_KEEP_TAIL = 1

/** Vertical distance between two rows of the tree. */
export const ROW = 62

/** Horizontal gap between two sibling turn columns of a downward tree. */
export const COLUMN_GAP = 30

/** Horizontal distance between two sibling turn columns of a downward tree. */
export const COLUMN_PITCH = NODE_W + COLUMN_GAP

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

// Trackpad pinch arrives as a ctrl-modified wheel whose deltas are small and
// arrive in bursts, where a mouse notch arrives as one delta near 100. The base
// is tuned for the pinch's short deltas (about 2% per pixel at 1.02), and the
// minimum below gives a sub-pixel event a usable step too. The per-event cap
// still keeps a coarse notch from lurching.
/** Scale one pixel of wheel delta multiplies the canvas by. */
export const WHEEL_ZOOM_BASE = 1.02

/** Smallest wheel delta a zoom event applies, so trackpad micro-events still move. */
export const WHEEL_ZOOM_MIN_DELTA = 1

/** Largest scale change one wheel event may apply on its own. */
export const WHEEL_ZOOM_MAX_STEP = 1.25

// Popovers, used only to keep them inside the panel.
/** Width of the node action popover. */
export const MENU_W = 184

/** Height assumed for the action popover when clamping it inside the panel. */
export const MENU_H = 160

/** Inset the action popover keeps from the panel's edges. */
export const MENU_INSET = 8

/** The three edge kinds the canvas draws, each with its own stroke treatment. */
export type EdgeKind = 'chain' | 'fork' | 'sub'

/** Stylesheet class per edge kind. */
export const EDGE_CLASS: Readonly<Record<EdgeKind, string>> = {
  chain: 'dsm__edge dsm__edge--chain',
  fork: 'dsm__edge dsm__edge--fork',
  sub: 'dsm__edge dsm__edge--sub',
}
