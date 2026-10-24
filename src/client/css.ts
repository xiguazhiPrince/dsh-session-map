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

/* The composer's Git branch badge. It is a reading, not a control, so it has
   no border or hover fill; it sits in the tool row at the host's text scale. */
.dsm-git {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 220px;
  height: 24px;
  padding: 0 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
}
.dsm-git--muted { opacity: 0.72; }
.dsm-git--error .dsm-git__name { color: var(--dsw-alias-state-error-primary); }
.dsm-git__glyph { flex: 0 0 auto; display: block; opacity: 0.8; }
.dsm-git__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dsm-git--muted .dsm-git__name {
  color: var(--dsw-alias-label-secondary);
  font-weight: 400;
}

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
/* The canvas-scope switch: one segmented control whose active option is filled,
   because "which Sessions am I looking at" is a state the bar has to state. */
.dsm__seg {
  display: inline-flex;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  overflow: hidden;
}
.dsm__segBtn {
  appearance: none;
  border: 0;
  border-radius: 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  padding: 5px 10px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
}
.dsm__segBtn + .dsm__segBtn { border-left: 1px solid var(--dsw-alias-border-l2); }
.dsm__segBtn:hover { color: var(--dsw-alias-brand-primary); }
.dsm__segBtn[data-active='true'] {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-brand-primary);
  font-weight: 600;
}
/* A neutral explanation in the toolbar, next to the error text it is not. */
.dsm__note { color: var(--dsw-alias-label-secondary); font-size: 11px; }
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
.dsm__edge--chain { stroke: var(--dsw-alias-border-l2); }
.dsm__edge--fork { stroke: var(--dsw-alias-border-l2); }
.dsm__edge--sub { stroke-dasharray: 4 4; }
.dsm__caption {
  position: absolute;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
/* border-l2 is the theme's stronger neutral line; unselected cards need it to
   read as cards at all against the canvas. The left stripe is the Session's own
   colour, so a chain of own turns reads as one line. */
.dsm__node {
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  box-sizing: border-box;
  padding: 5px 9px 5px 11px;
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-left: 3px solid var(--dsm-tone, var(--dsw-alias-border-l2));
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.dsm__node:hover {
  border-color: var(--dsw-alias-brand-primary);
  border-left-color: var(--dsm-tone, var(--dsw-alias-brand-primary));
}
.dsm__node[data-current='true'] {
  border-color: var(--dsw-alias-brand-primary);
  border-left-color: var(--dsm-tone, var(--dsw-alias-brand-primary));
  box-shadow: 0 0 0 1.5px var(--dsw-alias-brand-primary);
}
/* The inherited prefix of the current Session stays visible as context without
   competing with the Session's own strong ring. */
.dsm__node[data-on-current-path='true'] {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l2));
  border-left-color: var(--dsm-tone, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, var(--dsw-alias-bg-layer-1));
}
.dsm__node[data-subagent='true'] { border-style: dashed; }
.dsm__node[data-menu='true'] {
  border-color: var(--dsw-alias-brand-primary);
  border-left-color: var(--dsm-tone, var(--dsw-alias-brand-primary));
}
/* A Session with no own turn still gets a place in the tree: its label is the
   whole card, and the dashed edge says this is an anchor rather than a turn. */
.dsm__node[data-kind='head'] {
  border-style: dashed;
  background: var(--dsw-alias-bg-layer-2);
}
.dsm__tagRow {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding-right: 34px;
}
.dsm__tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsm-tone, var(--dsw-alias-border-l2)) 16%, transparent);
  color: var(--dsm-tone, var(--dsw-alias-label-secondary));
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsm__tagText {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsm__tagNote {
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
  white-space: nowrap;
}
.dsm__prompt {
  display: block;
  padding-right: 34px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 15px;
}
.dsm__node[data-kind='head'] .dsm__prompt { color: var(--dsw-alias-label-secondary); }
.dsm__branch {
  position: absolute;
  top: 4px;
  right: 6px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
  line-height: 13px;
  white-space: nowrap;
}
/* Eight stable session tones. The tag tints itself with the tone and the card's
   left stripe carries it down the Session's own chain. */
.dsm__node[data-tone='0'] { --dsm-tone: #4f7cff; }
.dsm__node[data-tone='1'] { --dsm-tone: #2aa889; }
.dsm__node[data-tone='2'] { --dsm-tone: #c26a2e; }
.dsm__node[data-tone='3'] { --dsm-tone: #9a5cd0; }
.dsm__node[data-tone='4'] { --dsm-tone: #c94f75; }
.dsm__node[data-tone='5'] { --dsm-tone: #6b8e23; }
.dsm__node[data-tone='6'] { --dsm-tone: #3f8fa8; }
.dsm__node[data-tone='7'] { --dsm-tone: #8a6d3b; }
/* One folded straight run: the plus count that opens the middle again. It sits
   on the straight chain edge between the run's kept head and tail. */
.dsm__marker {
  position: absolute;
  display: block;
  box-sizing: border-box;
  padding: 0 10px;
  line-height: 20px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.dsm__marker:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
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
