/**
 * The plugin's whole stylesheet, injected once per apply.
 *
 * The product has no `styles` service outside the dynamic runtime, so the
 * sheet travels as this string and `apply` owns the `<style>` element that
 * carries it.
 *
 * NOTE: this stylesheet is a template literal. Never write a backtick or a
 * dollar-brace sequence inside it, not even in a CSS comment: the first
 * backtick ends the string and the rest is parsed as JavaScript.
 *
 * @module dsh-session-map/client/css
 */

/** Every rule the overview and the canvas use, in one sheet. */
export const CSS = `
.dsv-ov {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px 28px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.6;
}
.dsv-ov--panel { padding: 14px 16px; gap: 12px; }
.dsv-ov__head { font-size: 15px; font-weight: 600; }
.dsv-ov--panel .dsv-ov__head { font-size: 14px; }
.dsv-ov__sub { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 2px; }
.dsv-ov__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.dsv-ov--panel .dsv-ov__grid { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
.dsv-ov__card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsv-ov--panel .dsv-ov__card { padding: 8px 10px; border-radius: 8px; }
.dsv-ov__cardLabel { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-bottom: 6px; }
.dsv-ov--panel .dsv-ov__cardLabel { margin-bottom: 2px; }
.dsv-ov__cardValue { font-size: 20px; font-weight: 600; }
.dsv-ov--panel .dsv-ov__cardValue { font-size: 16px; }
.dsv-ov__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsv-ov__button {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.dsv-ov__button:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsv-ov__error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dsv-ov__foot { color: var(--dsw-alias-label-secondary); font-size: 12px; word-break: break-all; }

.dsm-launch {
  appearance: none;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 5px 10px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
}
.dsm-launch:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
/* The launcher and the reason its last click failed, kept on one line. */
.dsm-launchWrap { display: inline-flex; align-items: center; gap: 6px; }

/* height:100% resolves only where the seat has a definite height (the right
   column's pane); in the conversation the parent is auto-height, so this
   collapses to auto and the panel keeps its viewport-derived basis. */
.dsm {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px 24px;
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.dsm__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsm__title { font-size: 15px; font-weight: 600; }
.dsm__meta { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsm__error { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
.dsm__spacer { flex: 1 1 auto; }
.dsm__btn {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 5px 11px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  min-width: 32px;
}
.dsm__btn:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsm__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  user-select: none;
}
/* The keyboard affordance keeps the shortcut list out of the toolbar until it
   is asked for: one glyph, and a panel anchored under it. */
.dsm__help { position: relative; display: inline-flex; }
.dsm__helpBtn { display: inline-flex; align-items: center; justify-content: center; padding: 5px 8px; }
.dsm__helpBtn[data-open='true'] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsm__helpPanel {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 3px;
  box-sizing: border-box;
  min-width: 208px;
  padding: 9px 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 6px 20px rgb(0 0 0 / 22%);
}
.dsm__helpRow { display: flex; align-items: baseline; gap: 10px; font-size: 11px; line-height: 1.6; }
.dsm__helpKey { flex: 0 0 auto; min-width: 92px; color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsm__helpText { color: var(--dsw-alias-label-secondary); }
/* flex-basis stays the viewport clamp; flex-grow claims whatever the seat has
   left over, so a tall right column gets a tall canvas. */
.dsm__panel {
  position: relative;
  flex: 1 1 auto;
  height: clamp(380px, 60vh, 760px);
  min-height: 380px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
.dsm__panel[data-dragging='true'] { cursor: grabbing; }
.dsm__stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.dsm__svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.dsm__edge { fill: none; stroke: var(--dsw-alias-border-l2); stroke-width: 1.5; }
.dsm__edge--sub { stroke-dasharray: 4 4; }
/* The outgoing wire a Session's turns are threaded on: one straight run from
   the card's right edge to the point its branches leave from. */
.dsm__edge--wire { stroke: var(--dsw-alias-border-l2); stroke-width: 1.5; stroke-dasharray: 1 4; stroke-linecap: round; }
.dsm__caption {
  position: absolute;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
/* border-l2 is the theme's stronger neutral line; unselected cards need it to
   read as cards at all against the canvas. Selection adds the brand ring on
   top, so the two states stay distinct. */
.dsm__node {
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.dsm__node:hover { border-color: var(--dsw-alias-brand-primary); }
.dsm__node[data-current='true'] {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 1.5px var(--dsw-alias-brand-primary);
}
.dsm__node[data-subagent='true'] { border-style: dashed; }
.dsm__node[data-menu='true'] { border-color: var(--dsw-alias-brand-primary); }
.dsm__nodeTitle { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.dsm__nodeMeta {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
}
/* One user turn as a labelled bead threaded on its Session's outgoing wire:
   an opaque capsule that hides the wire behind it, and a button so it can
   offer its own actions. The preview is cut by the fixed width; the tooltip
   always carries the whole line the Host projected. */
.dsm__bead {
  position: absolute;
  display: block;
  appearance: none;
  box-sizing: border-box;
  padding: 0 10px;
  line-height: 20px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 10px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.dsm__bead:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsm__bead[data-menu='true'] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
/* A line's state as one clickable capsule on its wire: either this Session's
   turns are hidden and the capsule carries a plus count, or they are drawn and
   it carries a minus count that collapses them again. The inherited-prefix
   folder uses the same shape under its own key. */
.dsm__marker {
  position: absolute;
  display: block;
  box-sizing: border-box;
  padding: 0 10px;
  line-height: 20px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 10px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.dsm__marker:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsm__marker[data-kind='line'] { border-style: solid; }
/* The node's action popover. It lives outside the zoom transform, so its text
   stays legible at any canvas scale; its coordinates are derived from the
   target's screen position on every render, which keeps it pinned while
   panning. */
.dsm__menu {
  position: absolute;
  z-index: 3;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 6px 20px rgb(0 0 0 / 22%);
}
.dsm__menuTitle {
  padding: 2px 6px 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsm__menuItem {
  appearance: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  padding: 6px 8px;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dsm__menuItem:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }
.dsm__menuNote {
  padding: 2px 8px 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 1.5;
}
.dsm__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-secondary); flex: 0 0 auto; }
.dsm__dot[data-state='running'] { background: var(--dsw-alias-state-success-primary); }
.dsm__dot[data-state='completed'] { background: var(--dsw-alias-state-warn-primary); }
.dsm__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
}
`
