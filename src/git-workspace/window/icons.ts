/**
 * Inline SVG icons for the Git tool window.
 *
 * The browser half cannot import the product's icon set, so the handful of
 * glyphs the panel needs live here as plain elements using `currentColor`.
 *
 * @module dsh-session-map/git-workspace/window/icons
 */
import * as React from 'react'

/** Props every icon accepts. */
export interface IconProps {
  readonly size?: number
}

/** Build one 16×16 stroke icon. */
function icon(path: string, props: IconProps, filled = false): React.ReactElement {
  const size = props.size ?? 16
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    React.createElement('path', {
      d: path,
      fill: filled ? 'currentColor' : 'none',
      stroke: filled ? 'none' : 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

/** Sidebar entry icon; receives the owner's selected state. */
export function GitPanelIcon(props: { readonly size: number; readonly active: boolean }): React.ReactElement {
  return React.createElement(
    'span',
    { className: props.active ? 'dgw-panelIcon dgw-panelIcon--active' : 'dgw-panelIcon' },
    icon('M4 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM12 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 6.5v3M12 5h-4.5A3.5 3.5 0 0 0 4 8.5v1', { size: props.size }),
  )
}

/** Local branch. */
export function BranchIcon(props: IconProps): React.ReactElement {
  return icon('M4 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM12 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 6.5v3M12 5h-4.5A3.5 3.5 0 0 0 4 8.5v1', props)
}

/** Remote-tracking branch. */
export function RemoteIcon(props: IconProps): React.ReactElement {
  return icon('M3 8a5 5 0 0 1 5-5M13 8a5 5 0 0 1-5 5M6 8h4M8 6v4', props)
}

/** Tag. */
export function TagIcon(props: IconProps): React.ReactElement {
  return icon('M3 3h5l5 5-5 5-5-5V3ZM5.5 5.5h.01', props)
}

/** Commit node. */
export function CommitIcon(props: IconProps): React.ReactElement {
  return icon('M8 2v12M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', props)
}

/** Generic file. */
export function FileIcon(props: IconProps): React.ReactElement {
  return icon('M4 2h5l3 3v9H4V2ZM9 2v3h3', props)
}

/** Folder. */
export function FolderIcon(props: IconProps): React.ReactElement {
  return icon('M2 4h4l1.5 2H14v7H2V4Z', props)
}

/** Refresh. */
export function RefreshIcon(props: IconProps): React.ReactElement {
  return icon('M13 8a5 5 0 1 1-1.5-3.5M13 3v3.5H9.5', props)
}

/** Fetch. */
export function FetchIcon(props: IconProps): React.ReactElement {
  return icon('M8 2v8M5 7l3 3 3-3M3 13h10', props)
}

/** Push. */
export function PushIcon(props: IconProps): React.ReactElement {
  return icon('M8 13V5M5 8l3-3 3 3M3 2h10', props)
}

/** Chevron; rotate with CSS. */
export function ChevronIcon(props: IconProps): React.ReactElement {
  return icon('M6 4l4 4-4 4', props)
}

/** Search. */
export function SearchIcon(props: IconProps): React.ReactElement {
  return icon('M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM10.5 10.5 14 14', props)
}

/** Copy. */
export function CopyIcon(props: IconProps): React.ReactElement {
  return icon('M6 6h7v7H6V6ZM3 10V3h7', props)
}

/** Fullscreen (corner brackets); the right-column page's presentation switch. */
export function FullscreenIcon(props: IconProps): React.ReactElement {
  return icon('M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3', props)
}

/** Close. */
export function CloseIcon(props: IconProps): React.ReactElement {
  return icon('M4 4l8 8M12 4l-8 8', props)
}

/** Panel toggle (rectangle with a divider); used for the commit panel. */
export function PanelLeftIcon(props: IconProps): React.ReactElement {
  return icon('M2 3h12v10H2zM6 3v10', props)
}

/** Side-by-side diff presentation. */
export function SideBySideIcon(props: IconProps): React.ReactElement {
  return icon('M2 3h5v10H2zM9 3h5v10H9z', props)
}

/** Unified diff presentation. */
export function UnifiedIcon(props: IconProps): React.ReactElement {
  return icon('M2 3h12M2 6h12M2 9h12M2 12h8', props)
}
