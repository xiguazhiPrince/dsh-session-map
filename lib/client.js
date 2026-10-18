window.__ModuleLoader__.load({
	id: "dsh-session-map",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/css.ts
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
		const CSS = `
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
`;
		//#endregion
		//#region src/client/constants.ts
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
		const OVERVIEW_KIND = "session-overview";
		/** Tab-type id the overview body registers under. */
		const OVERVIEW_TYPE_ID = "dsh-session-map.overview";
		/** Kind (the `openTab` discriminator) of the turn-tree canvas page. */
		const MAP_KIND = "session-map";
		/** Tab-type id the canvas body registers under. */
		const MAP_TYPE_ID = "dsh-session-map.map";
		/** Lowest canvas scale the toolbar and the wheel will reach. */
		const MIN_ZOOM = .15;
		/** Canvas scale the toolbar reports as 100%. */
		const BASE_ZOOM = 1.4;
		/** Highest canvas scale the toolbar and the wheel will reach. */
		const MAX_ZOOM = 2.8;
		/** Scale one pixel of wheel delta multiplies the canvas by. */
		const WHEEL_ZOOM_BASE = 1.005;
		/** Largest scale change one wheel event may apply on its own. */
		const WHEEL_ZOOM_MAX_STEP = 1.25;
		/** Stylesheet class per edge kind. */
		const EDGE_CLASS = {
			chain: "dsm__edge dsm__edge--chain",
			fork: "dsm__edge dsm__edge--fork",
			sub: "dsm__edge dsm__edge--sub"
		};
		//#endregion
		//#region src/client/flags.ts
		/**
		* Plugin-run flags: state that outlives one mounted View.
		*
		* Both seats (the Conversation tab and the right column's tab) are
		* session-scoped, so switching Session unmounts the View and would re-run a
		* `React.useState` initializer. A flag lives on the plugin run instead, and its
		* subscription keeps two simultaneously mounted instances in step.
		*
		* @module dsh-session-map/client/flags
		*/
		/**
		* A flag that belongs to the plugin run, not to one mounted View.
		* @param initial - value before the first change.
		* @returns getter, setter, and subscribe.
		*/
		function createFlag(initial) {
			let value = initial;
			const listeners = /* @__PURE__ */ new Set();
			return {
				get: () => value,
				set: (next) => {
					if (next === value) return;
					value = next;
					for (const listener of [...listeners]) listener();
				},
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				}
			};
		}
		/**
		* Read one plugin-run flag as component state.
		* @param flag - the flag created in the plugin body.
		* @returns current value and a setter.
		*/
		function useFlag(flag) {
			const [value, setValue] = react.useState(flag.get());
			react.useEffect(() => flag.subscribe(() => {
				setValue(flag.get());
			}), []);
			return [value, (next) => {
				flag.set(next);
			}];
		}
		/**
		* Copy a Set with one id added or removed.
		* @param set - the set to copy.
		* @param id - the member to add or remove.
		* @param present - whether the member belongs in the copy.
		* @returns a new set; the input is left alone.
		*/
		function withMember(set, id, present) {
			const next = new Set(set);
			if (present) next.add(id);
			else next.delete(id);
			return next;
		}
		//#endregion
		//#region src/client/graph.ts
		/**
		* Canvas construction: the union tree of user turns over the listed Sessions,
		* the session heads that anchor turns-less Sessions, and the folded runs that
		* keep long chains readable.
		*
		* A Session is not a node here: it is a colour, a label on its first own turn,
		* and — when it has no own turn at all — a head chip. A fork child's log begins
		* with a copy of its parent's turns, so those leading turns are matched against
		* the parent's outline and drawn ONCE, on the ancestor's chain; the child's head
		* hangs from the turn the fork actually happened at.
		*
		* Everything here is a pure function of the listed Sessions, the Workspace
		* membership, and the fold switches, so equal inputs always produce an equal
		* layout and the Views can rebuild it on every render.
		*
		* @module dsh-session-map/client/graph
		*/
		/**
		* The Session the app is showing, taken from the listed rows.
		*
		* The Session list snapshot carries no `current` field: the controller publishes
		* `{ ids, byId, phase, projectionsBySession }` and every shipped package derives
		* the foreground Session as the row the main view retains. A row without
		* retention counts is not it, so a list that has not been adopted yet answers
		* `undefined` rather than naming an arbitrary Session.
		* @param byId - listed Session summaries, in host order.
		* @returns the retained Session's id, or `undefined` when nothing retains one.
		*/
		function mainSessionId(byId) {
			for (const id of Object.keys(byId)) if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id;
		}
		/**
		* The root of one listed Session's fork tree: the last ancestor the row map
		* still lists.
		*
		* A tree on this canvas is the connected component of the parent links, so its
		* root is the node whose own parent is absent or unlisted. The walk stops at an
		* already-visited id as well, so a Session whose ancestry loops answers with
		* itself rather than never returning.
		* @param id - the Session to resolve.
		* @param byId - listed Session summaries.
		* @returns the root ancestor's id, which is `id` itself for a root.
		*/
		function treeRootId(id, byId) {
			const seen = {};
			seen[id] = true;
			let current = id;
			let parentId = byId[current]?.parentId;
			while (parentId !== void 0 && seen[parentId] !== true) {
				if (byId[parentId] === void 0) return current;
				seen[parentId] = true;
				current = parentId;
				parentId = byId[current]?.parentId;
			}
			return current;
		}
		/** The tone palette size; the CSS sheet defines one rule per index. */
		const TONE_COUNT = 8;
		/**
		* A stable 0..7 tone for one Session id.
		* @param id - the Session id.
		* @returns the tone index.
		*/
		function toneOf(id) {
			let hash = 2166136261;
			for (let index = 0; index < id.length; index += 1) {
				hash ^= id.charCodeAt(index);
				hash = Math.imul(hash, 16777619);
			}
			return (hash >>> 0) % TONE_COUNT;
		}
		/**
		* The label a Session shows: its projected title, or its id when it has none.
		* @param summary - the listed row, when it is listed.
		* @param id - the Session id used as the fallback.
		* @returns the display label.
		*/
		function sessionLabel(summary, id) {
			if (summary === void 0) return String(id);
			const title = summary.displayTitle;
			if (typeof title === "string" && title !== "") return title;
			return String(id);
		}
		/**
		* Normalise one wire outline entry. Every field is re-checked: the projection is
		* wire data, not a type this plugin controls.
		* @param entry - the entry the Host projected.
		* @param index - its position, used only when `turn` is absent.
		* @returns the compared identity and displayed previews.
		*/
		function turnEntry(entry, index) {
			const record = typeof entry === "object" && entry !== null ? entry : void 0;
			const turn = record === void 0 ? void 0 : record.turn;
			const seq = record === void 0 ? void 0 : record.seq;
			const prompt = record === void 0 ? void 0 : record.prompt;
			const response = record === void 0 ? void 0 : record.response;
			return {
				turn: typeof turn === "number" ? turn : index + 1,
				seq: typeof seq === "number" ? seq : void 0,
				prompt: typeof prompt === "string" ? prompt : "",
				response: typeof response === "string" ? response : ""
			};
		}
		/**
		* Whether two outlines carry the same turn at one position.
		*
		* The child's inherited prefix is a copy of the parent's events, so the turn
		* number and both bounded previews agree. `seq` is deliberately not required:
		* a seed may renumber it, while the turn number is host-assigned and copied.
		* @param left - the child's entry.
		* @param right - the parent's entry.
		* @returns true when the entries are the same turn.
		*/
		function sameTurn(left, right) {
			if (left === void 0 || right === void 0) return false;
			return left.turn === right.turn && left.prompt === right.prompt && left.response === right.response;
		}
		/** The turn outline a listed Session's own projection values carry, if any. */
		function outlineOf(summary) {
			if (summary === void 0) return void 0;
			const values = summary.projectionValues;
			if (values === void 0 || values === null) return void 0;
			const outline = values.turnOutline;
			if (!Array.isArray(outline)) return void 0;
			return outline;
		}
		/**
		* Normalise one Session's outline and remember whether the projection existed.
		* @param summary - the listed row, when it is listed.
		* @returns the entries, plus whether the projection was absent.
		*/
		function outlineFor(summary) {
			const outline = outlineOf(summary);
			if (outline === void 0) return {
				entries: [],
				missing: true
			};
			return {
				entries: outline.map((entry, index) => turnEntry(entry, index)),
				missing: false
			};
		}
		/**
		* Longest common prefix of two outlines, by {@link sameTurn}.
		* @param left - the child's entries.
		* @param right - the parent's entries.
		* @returns the matched length.
		*/
		function commonPrefix(left, right) {
			let shared = 0;
			while (shared < left.length && shared < right.length && sameTurn(left[shared], right[shared])) shared += 1;
			return shared;
		}
		/**
		* Collapse whitespace the way the Host's bounded preview does, for comparing a
		* loaded message with the turn prompt the outline already carries.
		* @param text - the raw message or preview.
		* @returns the normalised text.
		*/
		function normalizedMessageText(text) {
			return text.replace(/\s+/g, " ").trim();
		}
		/**
		* Whether one loaded human message is the turn's first prompt.
		*
		* The outline prompt is a bounded preview: it may be clipped with an ellipsis
		* and its whitespace is collapsed. A prefix comparison in either direction
		* keeps the full loaded message and the preview comparable without treating a
		* steering message as the prompt.
		* @param text - the loaded message text.
		* @param prompt - the outline's prompt preview.
		* @returns true when the message is the prompt.
		*/
		function matchesTurnPrompt(text, prompt) {
			const message = normalizedMessageText(text);
			const preview = normalizedMessageText(prompt).replace(/…$/, "");
			if (preview === "") return message === "";
			if (message === "") return false;
			const head = preview.slice(0, Math.min(24, preview.length));
			return message.startsWith(head) || preview.startsWith(message.slice(0, Math.min(24, message.length)));
		}
		/**
		* Group loaded human messages by the turn whose `turn/start` seq precedes them.
		*
		* Inherited turns are skipped: their nodes belong to the ancestor. The first
		* message of an own turn is the prompt the outline already carries; every later
		* message is a steering input and earns its own node.
		* @param plan - the Session's build plan.
		* @param messages - human messages from the Session's loaded event window.
		* @returns steering messages by outline index; absent turns have none.
		*/
		function turnMessagesFor(plan, messages) {
			const byTurn = /* @__PURE__ */ new Map();
			if (messages.length === 0) return byTurn;
			const sorted = [...messages].sort((left, right) => left.seq - right.seq);
			let turnIndex = -1;
			let cursor = 0;
			for (const message of sorted) {
				while (cursor < plan.outline.length) {
					const start = plan.outline[cursor]?.seq;
					if (start === void 0 || start > message.seq) break;
					turnIndex = cursor;
					cursor += 1;
				}
				if (turnIndex < plan.inheritedCount) continue;
				const list = byTurn.get(turnIndex);
				if (list === void 0) byTurn.set(turnIndex, [message]);
				else list.push(message);
			}
			for (const [index, list] of byTurn) {
				const entry = plan.outline[index];
				if (entry === void 0) continue;
				const first = list[0];
				if (first !== void 0 && matchesTurnPrompt(first.text, entry.prompt)) list.shift();
			}
			return byTurn;
		}
		/** Trees that grow rightward: depth along x, sibling bands down y. */
		const RIGHTWARD = {
			vertical: false,
			nodeAlong: 200,
			nodeAcross: 46,
			bandPitch: 62,
			bandSlack: 16,
			treeGap: 36
		};
		/** Trees that grow downward: depth along y, sibling bands across x. */
		const DOWNWARD = {
			vertical: true,
			nodeAlong: 46,
			nodeAcross: 200,
			bandPitch: 230,
			bandSlack: 30,
			treeGap: 36
		};
		/**
		* Place one box given its position and size on the growth and band axes.
		* @param axis - the direction in force.
		* @param along - position along the growth axis.
		* @param across - position across the growth axis.
		* @param alongSize - extent along the growth axis.
		* @param acrossSize - extent across the growth axis.
		* @returns the same rectangle in stage coordinates.
		*/
		function boxOf(axis, along, across, alongSize, acrossSize) {
			return axis.vertical ? {
				x: across,
				y: along,
				w: acrossSize,
				h: alongSize
			} : {
				x: along,
				y: across,
				w: alongSize,
				h: acrossSize
			};
		}
		/**
		* The middle of a card across the growth axis.
		* @param axis - the direction in force.
		* @param node - the placed card.
		* @returns the card's centre coordinate across the axis.
		*/
		function crossCentre(axis, node) {
			return axis.vertical ? node.x + 100 : node.y + 23;
		}
		/**
		* The card edge its children leave from.
		* @param axis - the direction in force.
		* @param node - the placed card.
		* @returns the coordinate along the growth axis.
		*/
		function farEdge(axis, node) {
			return axis.vertical ? node.y + 46 : node.x + 200;
		}
		/**
		* The card edge a child arrives at.
		* @param axis - the direction in force.
		* @param node - the placed card.
		* @returns the coordinate along the growth axis.
		*/
		function nearEdge(axis, node) {
			return axis.vertical ? node.y : node.x;
		}
		/**
		* The run from one turn to the next turn of the same Session. A centered parent
		* may sit between two fork branches, so the child can be in another band; the
		* line then runs diagonally instead of pretending both cards share a centre.
		* @param axis - the direction in force.
		* @param from - the parent card.
		* @param to - the child card.
		* @returns the path data.
		*/
		function chainPath(axis, from, to) {
			const x1 = axis.vertical ? crossCentre(axis, from) : farEdge(axis, from);
			const y1 = axis.vertical ? farEdge(axis, from) : crossCentre(axis, from);
			const x2 = axis.vertical ? crossCentre(axis, to) : nearEdge(axis, to);
			const y2 = axis.vertical ? nearEdge(axis, to) : crossCentre(axis, to);
			return "M " + x1 + " " + y1 + " L " + x2 + " " + y2;
		}
		/**
		* The bezier joining a node's far edge to a fork child's near edge.
		* @param axis - the direction in force.
		* @param from - the parent card.
		* @param to - the child card.
		* @returns the path data.
		*/
		function forkPath(axis, from, to) {
			const x1 = axis.vertical ? crossCentre(axis, from) : from.outAlong;
			const y1 = axis.vertical ? from.outAlong : crossCentre(axis, from);
			const x2 = axis.vertical ? crossCentre(axis, to) : nearEdge(axis, to);
			const y2 = axis.vertical ? nearEdge(axis, to) : crossCentre(axis, to);
			const bend = axis.vertical ? Math.max(18, (y2 - y1) / 2) : Math.max(18, (x2 - x1) / 2);
			return axis.vertical ? "M " + x1 + " " + y1 + " C " + x1 + " " + (y1 + bend) + " " + x2 + " " + (y2 - bend) + " " + x2 + " " + y2 : "M " + x1 + " " + y1 + " C " + (x1 + bend) + " " + y1 + " " + (x2 - bend) + " " + y2 + " " + x2 + " " + y2;
		}
		/**
		* Read a Session plan's head, which is always created before the plan is used.
		* @param plan - the plan.
		* @returns its head node.
		*/
		function headOf(plan) {
			const head = plan.headNode;
			if (head === void 0) throw new Error("session plan has no head: " + plan.id);
			return head;
		}
		/**
		* The nearest defined outline node at or before one index.
		* @param plan - the Session whose outline map to scan.
		* @param index - the outline index to start from.
		* @returns the nearest node, or `undefined` when the prefix starts hidden.
		*/
		function nearestNodeAtOrBefore(plan, index) {
			let cursor = Math.min(index, plan.nodeByIndex.length - 1);
			while (cursor >= 0) {
				const node = plan.nodeByIndex[cursor];
				if (node !== void 0) return node;
				cursor -= 1;
			}
		}
		/**
		* Build the canvas: turn nodes, session head chips, folded runs and edges.
		* @param ids - listed Session ids in host order.
		* @param byId - listed Session summaries.
		* @param workspaces - Workspace membership, for tree order and captions.
		* @param hideSubagents - whether subagent-origin Sessions are filtered out.
		* @param foldRuns - whether long straight runs collapse their middle stretch.
		* @param expandedRuns - run keys the reader has expanded.
		* @param scopeSessionId - when given, draw only this Session's own tree; an id
		* the row map does not carry is ignored and every listed Session is drawn.
		* @param direction - which way the trees grow.
		* @param messagesBySession - human messages from the loaded event windows of the
		* current Session and its ancestors; turns outside those windows keep one node.
		* @returns the positioned graph.
		*/
		function buildGraph(ids, byId, workspaces, hideSubagents, foldRuns, expandedRuns, scopeSessionId, direction, messagesBySession = {}) {
			let drawnIds = ids;
			let scopeId;
			if (scopeSessionId !== void 0 && byId[scopeSessionId] !== void 0) {
				const root = treeRootId(scopeSessionId, byId);
				const members = ids.filter((id) => treeRootId(id, byId) === root);
				if (members.length > 0) {
					drawnIds = members;
					scopeId = scopeSessionId;
				}
			}
			const candidateIds = [];
			for (const id of drawnIds) {
				const summary = byId[id];
				if (summary === void 0) continue;
				if (hideSubagents && summary.origin === "subagent") continue;
				candidateIds.push(id);
			}
			const plans = /* @__PURE__ */ new Map();
			const planOrder = [];
			const outlineCache = /* @__PURE__ */ new Map();
			const outlineOfSession = (id) => {
				if (id === void 0) return {
					entries: [],
					missing: true
				};
				const cached = outlineCache.get(id);
				if (cached !== void 0) return cached;
				const value = outlineFor(byId[id]);
				outlineCache.set(id, value);
				return value;
			};
			for (const id of candidateIds) {
				const summary = byId[id];
				if (summary === void 0) continue;
				const outline = outlineOfSession(id);
				const plan = {
					id,
					summary,
					title: sessionLabel(summary, id),
					outline: outline.entries,
					outlineMissing: outline.missing,
					directParentId: summary.parentId,
					hostedParent: void 0,
					inheritedCount: 0,
					hiddenInherited: 0,
					ownCount: 0,
					headNode: void 0,
					ownNodes: [],
					nodeByIndex: [],
					inheritedNodeIds: [],
					ordinal: 0,
					tone: toneOf(id),
					tailAnchor: void 0,
					inboundKind: "fork",
					children: []
				};
				plans.set(id, plan);
				planOrder.push(plan);
			}
			const hostedParentIdFor = (id) => {
				const seen = /* @__PURE__ */ new Set();
				seen.add(id);
				let parentId = byId[id]?.parentId;
				while (parentId !== void 0) {
					if (seen.has(parentId)) return void 0;
					seen.add(parentId);
					if (plans.has(parentId)) return parentId;
					const parent = byId[parentId];
					if (parent === void 0) return void 0;
					parentId = parent.parentId;
				}
			};
			const rootPlans = [];
			for (const plan of planOrder) {
				const hostedId = hostedParentIdFor(plan.id);
				const hosted = hostedId === void 0 ? void 0 : plans.get(hostedId);
				plan.hostedParent = hosted;
				if (hosted === void 0) rootPlans.push(plan);
				else hosted.children.push(plan);
			}
			const groupRank = {};
			for (const [group, workspace] of workspaces.entries()) for (const member of workspace.sessionIds) if (groupRank[member] === void 0) groupRank[member] = group;
			const rankOf = (id) => {
				const rank = groupRank[id];
				return rank === void 0 ? workspaces.length : rank;
			};
			rootPlans.sort((left, right) => {
				const groupLeft = rankOf(left.id);
				const groupRight = rankOf(right.id);
				if (groupLeft !== groupRight) return groupLeft - groupRight;
				const updatedLeft = typeof left.summary.updatedAt === "number" ? left.summary.updatedAt : 0;
				const updatedRight = typeof right.summary.updatedAt === "number" ? right.summary.updatedAt : 0;
				if (updatedLeft !== updatedRight) return updatedRight - updatedLeft;
				return left.id < right.id ? -1 : 1;
			});
			const ordered = [];
			const visitedSessions = /* @__PURE__ */ new Set();
			let ordinal = 0;
			const visitSession = (plan) => {
				if (visitedSessions.has(plan.id)) return;
				visitedSessions.add(plan.id);
				ordinal += 1;
				plan.ordinal = ordinal;
				ordered.push(plan);
				for (const child of plan.children) visitSession(child);
			};
			for (const root of rootPlans) visitSession(root);
			for (const plan of planOrder) visitSession(plan);
			const usedNodeIds = /* @__PURE__ */ new Set();
			const turnNodeId = (sessionId, entry, index) => {
				let id = "turn:" + sessionId + ":" + String(entry.turn);
				if (usedNodeIds.has(id)) id = id + ":" + String(index);
				usedNodeIds.add(id);
				return id;
			};
			const headChipId = (sessionId) => {
				const id = "head:" + sessionId;
				usedNodeIds.add(id);
				return id;
			};
			const turnMessageNodeId = (sessionId, turn, seq, turnIndex) => {
				let id = "turn:" + sessionId + ":" + String(turn) + ":msg:" + String(seq);
				if (usedNodeIds.has(id)) id = id + ":" + String(turnIndex);
				usedNodeIds.add(id);
				return id;
			};
			const allNodes = [];
			const forkChildrenOf = {};
			const processed = /* @__PURE__ */ new Set();
			let turnCount = 0;
			for (const plan of ordered) {
				const directParent = plan.directParentId === void 0 ? void 0 : plans.get(plan.directParentId);
				const directParentReady = directParent === void 0 || processed.has(directParent.id);
				let inheritedCount = 0;
				if (plan.directParentId !== void 0 && plan.directParentId !== plan.id && directParentReady) {
					const parentOutline = outlineOfSession(plan.directParentId);
					inheritedCount = commonPrefix(plan.outline, parentOutline.entries);
				}
				plan.inheritedCount = inheritedCount;
				plan.ownCount = plan.outline.length - inheritedCount;
				const ownNodes = [];
				plan.nodeByIndex = new Array(plan.outline.length);
				const messagesByTurn = turnMessagesFor(plan, messagesBySession[plan.id] ?? []);
				const makeTurnNode = (id, turn, prompt, response, isHead) => ({
					id,
					kind: "turn",
					sessionId: plan.id,
					turn,
					prompt,
					response,
					isHead,
					forkCount: 0,
					parentId: void 0,
					hiddenInherited: 0,
					outlineMissing: false,
					band: 0,
					x: 0,
					y: 0,
					outAlong: 0
				});
				for (let index = inheritedCount; index < plan.outline.length; index += 1) {
					const entry = plan.outline[index];
					if (entry === void 0) continue;
					const turnNodes = [makeTurnNode(turnNodeId(plan.id, entry, index), entry.turn, entry.prompt, entry.response, index === inheritedCount)];
					for (const message of messagesByTurn.get(index) ?? []) turnNodes.push(makeTurnNode(turnMessageNodeId(plan.id, entry.turn, message.seq, index), entry.turn, message.text, "", false));
					for (const node of turnNodes) ownNodes.push(node);
					const last = turnNodes[turnNodes.length - 1];
					if (last !== void 0) plan.nodeByIndex[index] = last;
					turnCount += 1;
				}
				plan.ownNodes = ownNodes;
				let head;
				const firstOwn = ownNodes[0];
				if (firstOwn !== void 0) head = firstOwn;
				else {
					head = {
						id: headChipId(plan.id),
						kind: "head",
						sessionId: plan.id,
						turn: null,
						prompt: "",
						response: "",
						isHead: true,
						forkCount: 0,
						parentId: void 0,
						hiddenInherited: 0,
						outlineMissing: plan.outlineMissing,
						band: 0,
						x: 0,
						y: 0,
						outAlong: 0
					};
					allNodes.push(head);
				}
				plan.headNode = head;
				allNodes.push(...ownNodes);
				const hosted = plan.hostedParent;
				const hiddenDirectParent = plan.directParentId !== void 0 && plan.directParentId !== plan.id && directParent === void 0;
				const sharedWithHosted = hiddenDirectParent && hosted !== void 0 ? commonPrefix(plan.outline, hosted.outline) : 0;
				for (let index = 0; index < inheritedCount; index += 1) {
					let mapped;
					if (directParent !== void 0 && processed.has(directParent.id)) mapped = directParent.nodeByIndex[index];
					else if (hiddenDirectParent && hosted !== void 0 && index < sharedWithHosted) mapped = hosted.nodeByIndex[index];
					if (mapped !== void 0) plan.nodeByIndex[index] = mapped;
				}
				const inheritedIds = [];
				const seenIds = /* @__PURE__ */ new Set();
				let hiddenInherited = 0;
				for (let index = 0; index < inheritedCount; index += 1) {
					const node = plan.nodeByIndex[index];
					if (node === void 0) {
						hiddenInherited += 1;
						continue;
					}
					if (!seenIds.has(node.id)) {
						seenIds.add(node.id);
						inheritedIds.push(node.id);
					}
				}
				plan.hiddenInherited = hiddenInherited;
				plan.inheritedNodeIds = inheritedIds;
				head.hiddenInherited = hiddenInherited;
				let attach;
				if (directParent !== void 0 && processed.has(directParent.id)) {
					const parentHead = headOf(directParent);
					if (directParent.ownCount === 0) attach = parentHead;
					else if (plan.summary.origin === "subagent" && inheritedCount === 0) attach = directParent.tailAnchor ?? parentHead;
					else attach = nearestNodeAtOrBefore(directParent, inheritedCount - 1) ?? parentHead;
				} else if (hiddenDirectParent && hosted !== void 0 && processed.has(hosted.id)) {
					const hostedHead = headOf(hosted);
					if (hosted.ownCount === 0) attach = hostedHead;
					else attach = nearestNodeAtOrBefore(hosted, sharedWithHosted - 1) ?? hostedHead;
				}
				if (attach !== void 0) {
					head.parentId = attach.id;
					attach.forkCount += 1;
					const siblings = forkChildrenOf[attach.id];
					if (siblings === void 0) forkChildrenOf[attach.id] = [head];
					else siblings.push(head);
					plan.inboundKind = plan.summary.origin === "subagent" ? "sub" : "fork";
				} else plan.inboundKind = plan.summary.origin === "subagent" ? "sub" : "fork";
				plan.tailAnchor = ownNodes[ownNodes.length - 1] ?? head;
				processed.add(plan.id);
			}
			const axis = direction === "vertical" ? DOWNWARD : RIGHTWARD;
			const markerAlong = axis.vertical ? 22 : 96;
			const markerAcross = axis.vertical ? 96 : 22;
			const runGap = Math.max(36, markerAlong + 16);
			const hiddenNodes = /* @__PURE__ */ new Set();
			const folds = [];
			const foldByHead = {};
			const runKeyOf = (node) => "run:" + node.id;
			for (const plan of ordered) {
				const own = plan.ownNodes;
				let start = 0;
				while (start < own.length) {
					const first = own[start];
					if (first === void 0) break;
					let end = start;
					while (end + 1 < own.length) {
						const current = own[end];
						if (current === void 0) break;
						if ((forkChildrenOf[current.id]?.length ?? 0) > 0) break;
						end += 1;
					}
					const length = end - start + 1;
					const runKey = runKeyOf(first);
					if (foldRuns && length > 8 && !expandedRuns.has(runKey)) {
						const keepHead = Math.min(2, length);
						const keepTail = Math.min(1, Math.max(0, length - keepHead));
						const visibleHeadIndex = start + keepHead - 1;
						const visibleTailIndex = end - keepTail + 1;
						const visibleHead = own[visibleHeadIndex];
						const visibleTail = own[visibleTailIndex];
						const hiddenCount = length - keepHead - keepTail;
						if (visibleHead !== void 0 && visibleTail !== void 0 && visibleHead !== visibleTail && hiddenCount > 0) {
							for (let index = start + keepHead; index < visibleTailIndex; index += 1) {
								const node = own[index];
								if (node !== void 0) hiddenNodes.add(node.id);
							}
							const fold = {
								runKey,
								count: hiddenCount,
								head: visibleHead,
								tail: visibleTail,
								gap: runGap
							};
							folds.push(fold);
							foldByHead[visibleHead.id] = fold;
						}
					}
					start = end + 1;
				}
			}
			const visibleOwnBySession = /* @__PURE__ */ new Map();
			const visibleChainOf = /* @__PURE__ */ new Map();
			const chainGapOf = /* @__PURE__ */ new Map();
			for (const plan of ordered) {
				const visible = plan.ownNodes.filter((node) => !hiddenNodes.has(node.id));
				visibleOwnBySession.set(plan.id, visible);
				for (let index = 0; index + 1 < visible.length; index += 1) {
					const from = visible[index];
					const to = visible[index + 1];
					if (from === void 0 || to === void 0) continue;
					visibleChainOf.set(from.id, to);
					chainGapOf.set(from.id, foldByHead[from.id] === void 0 ? 36 : runGap);
				}
			}
			const visibleNodes = allNodes.filter((node) => !hiddenNodes.has(node.id));
			const visibleNodesById = /* @__PURE__ */ new Map();
			for (const node of visibleNodes) visibleNodesById.set(node.id, node);
			const layoutRoots = ordered.filter((plan) => headOf(plan).parentId === void 0);
			if (layoutRoots.length === 0 && ordered.length > 0) {
				const promoted = ordered[0];
				if (promoted !== void 0) {
					const head = headOf(promoted);
					const parentId = head.parentId;
					if (parentId !== void 0) {
						const parent = visibleNodesById.get(parentId);
						if (parent !== void 0) {
							parent.forkCount = Math.max(0, parent.forkCount - 1);
							const siblings = forkChildrenOf[parent.id];
							if (siblings !== void 0) {
								const index = siblings.indexOf(head);
								if (index >= 0) siblings.splice(index, 1);
							}
						}
						head.parentId = void 0;
					}
					layoutRoots.push(promoted);
				}
			}
			const edges = [];
			const markers = [];
			const captions = [];
			let treeCursor = 0;
			let alongMax = 0;
			let treeIndex = 0;
			for (const plan of layoutRoots) {
				const root = headOf(plan);
				let bandCursor = 0;
				const visitedBands = /* @__PURE__ */ new Set();
				const assignBands = (node) => {
					if (visitedBands.has(node.id)) return;
					visitedBands.add(node.id);
					const chain = visibleChainOf.get(node.id);
					const forks = forkChildrenOf[node.id] ?? [];
					const children = [];
					if (chain !== void 0) {
						const before = Math.floor(forks.length / 2);
						for (let index = 0; index < before; index += 1) {
							const fork = forks[index];
							if (fork !== void 0) children.push(fork);
						}
						children.push(chain);
						for (let index = before; index < forks.length; index += 1) {
							const fork = forks[index];
							if (fork !== void 0) children.push(fork);
						}
					} else for (const fork of forks) children.push(fork);
					for (const child of children) assignBands(child);
					if (children.length === 0) {
						node.band = bandCursor;
						bandCursor += 1;
						return;
					}
					const first = children[0];
					const last = children[children.length - 1];
					if (first !== void 0 && last !== void 0) node.band = (first.band + last.band) / 2;
				};
				assignBands(root);
				const acrossBase = axis.vertical ? treeCursor : treeCursor + 24;
				const alongStart = axis.vertical ? 24 : 28;
				const placed = /* @__PURE__ */ new Set();
				const place = (node, along) => {
					if (placed.has(node.id)) return;
					placed.add(node.id);
					const across = acrossBase + node.band * axis.bandPitch;
					const box = boxOf(axis, along, across, axis.nodeAlong, axis.nodeAcross);
					node.x = box.x;
					node.y = box.y;
					node.outAlong = along + axis.nodeAlong;
					if (node.outAlong > alongMax) alongMax = node.outAlong;
					const chain = visibleChainOf.get(node.id);
					if (chain !== void 0) {
						const gap = chainGapOf.get(node.id) ?? 36;
						place(chain, node.outAlong + gap);
					}
					const forks = forkChildrenOf[node.id] ?? [];
					for (const fork of forks) place(fork, node.outAlong + 36);
				};
				place(root, alongStart);
				const owner = workspaces.find((item) => item.sessionIds.indexOf(plan.id) >= 0);
				const ownerTitle = owner === void 0 ? "" : String(owner.title || owner.path);
				captions.push({
					key: "caption-" + plan.id,
					x: axis.vertical ? treeCursor : 28,
					y: axis.vertical ? 0 : treeCursor,
					text: "会话树 " + String(treeIndex + 1) + (ownerTitle === "" ? " · 未归属工作区" : " · " + ownerTitle)
				});
				treeIndex += 1;
				treeCursor = acrossBase + bandCursor * axis.bandPitch - axis.bandSlack + axis.treeGap;
			}
			for (const fold of folds) {
				const node = fold.head;
				const centre = crossCentre(axis, node);
				const box = boxOf(axis, node.outAlong + (fold.gap - markerAlong) / 2, centre - markerAcross / 2, markerAlong, markerAcross);
				markers.push({
					id: "marker:" + fold.runKey,
					kind: "run",
					runKey: fold.runKey,
					count: fold.count,
					x: box.x,
					y: box.y
				});
			}
			for (const plan of ordered) {
				const visible = visibleOwnBySession.get(plan.id) ?? [];
				for (let index = 0; index + 1 < visible.length; index += 1) {
					const from = visible[index];
					const to = visible[index + 1];
					if (from === void 0 || to === void 0) continue;
					edges.push({
						key: "chain:" + from.id + ">" + to.id,
						kind: "chain",
						d: chainPath(axis, from, to)
					});
				}
			}
			for (const plan of ordered) {
				const head = headOf(plan);
				if (head.parentId === void 0) continue;
				const parent = visibleNodesById.get(head.parentId);
				if (parent === void 0) continue;
				edges.push({
					key: plan.inboundKind + ":" + parent.id + ">" + head.id,
					kind: plan.inboundKind,
					d: forkPath(axis, parent, head)
				});
			}
			const sessions = [];
			const sessionsById = {};
			for (const plan of ordered) {
				const head = headOf(plan);
				const visibleOwn = visibleOwnBySession.get(plan.id) ?? [];
				const parentSummary = plan.directParentId === void 0 ? void 0 : byId[plan.directParentId];
				const session = {
					id: plan.id,
					title: plan.title,
					ordinal: plan.ordinal,
					tone: plan.tone,
					parentSessionId: plan.directParentId,
					parentTitle: plan.directParentId === void 0 ? void 0 : sessionLabel(parentSummary, plan.directParentId),
					running: plan.summary.running === true,
					completed: plan.summary.completed === true,
					subagent: plan.summary.origin === "subagent",
					inheritedCount: plan.inheritedCount,
					ownCount: plan.ownCount,
					outlineMissing: plan.outlineMissing,
					hiddenInherited: plan.hiddenInherited,
					headNodeId: head.id,
					ownNodeIds: visibleOwn.map((node) => node.id),
					inheritedNodeIds: plan.inheritedNodeIds.filter((id) => !hiddenNodes.has(id))
				};
				sessions.push(session);
				sessionsById[session.id] = session;
			}
			return {
				nodes: visibleNodes,
				sessions,
				sessionsById,
				edges,
				markers,
				captions,
				sessionCount: sessions.length,
				turnCount,
				treeCount: layoutRoots.length,
				width: Math.max(axis.vertical ? treeCursor - axis.treeGap : alongMax, 0) + 56,
				height: Math.max(axis.vertical ? alongMax : treeCursor - axis.treeGap, 0) + 56,
				scopeSessionId: scopeId
			};
		}
		//#endregion
		//#region src/client/format.ts
		/**
		* Display formatters for the overview figures and the toolbar.
		*
		* Every formatter is total over `unknown`: the values reach a plugin as Host
		* projection wire data, so a missing or mistyped field renders as the dash
		* rather than breaking a card.
		*
		* @module dsh-session-map/client/format
		*/
		/**
		* Render a millisecond duration.
		* @param ms - duration in milliseconds, as wire data.
		* @returns seconds, minutes, or the dash when the value is not a positive duration.
		*/
		function formatMs(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
			if (ms < 1e3) return Math.round(ms) + " ms";
			const seconds = ms / 1e3;
			if (seconds < 60) return seconds.toFixed(1) + " s";
			const minutes = Math.floor(seconds / 60);
			return minutes + " min " + Math.round(seconds - minutes * 60) + " s";
		}
		/**
		* Render a count.
		* @param value - count as wire data.
		* @returns the number as text, or the dash when it is not one.
		*/
		function formatCount(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			return String(value);
		}
		/**
		* Clamp a finite number into a range, falling back to the lower bound.
		* @param value - the number to clamp.
		* @param min - lower bound.
		* @param max - upper bound.
		* @returns the clamped value, or `min` when `value` is not finite.
		*/
		function clampNumber(value, min, max) {
			if (!Number.isFinite(value)) return min;
			if (value < min) return min;
			if (value > max) return max;
			return value;
		}
		/**
		* The message of a thrown value, or its string form when it carries none.
		* @param cause - the thrown value.
		* @returns display text for the error.
		*/
		function errorText(cause) {
			const message = typeof cause === "object" && cause !== null ? cause.message : void 0;
			return String(message ? message : cause);
		}
		//#endregion
		//#region src/client/views.ts
		/**
		* The three View bodies: the plain Session overview (Conversation tab and
		* right-column tab), the launcher button, and the turn-tree canvas factory.
		*
		* They receive everything through their composed props and a {@link
		* SessionMapRuntime}; `ctx` never crosses this boundary, so a body can be
		* rendered by a test or by the slot renderer without a runtime.
		*
		* @module dsh-session-map/client/views
		*/
		const KEYBOARD_GLYPH = react.createElement("svg", {
			width: 14,
			height: 14,
			viewBox: "0 0 16 16",
			"aria-hidden": "true",
			focusable: "false"
		}, react.createElement("rect", {
			x: 1,
			y: 3.5,
			width: 14,
			height: 9,
			rx: 2,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.2
		}), react.createElement("path", {
			d: "M3.5 6.5h1M6 6.5h1M8.5 6.5h1M11 6.5h1.5M4 9.5h8",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.2,
			strokeLinecap: "round"
		}));
		/**
		* The scope a canvas opens in before the reader picks one.
		*
		* A reader arrives with one Session in mind — the one the app is showing — so
		* the canvas opens on that Session's tree instead of on the whole map. The
		* toolbar switch is how the whole map is asked for.
		*/
		const DEFAULT_MAP_SCOPE = "current";
		/**
		* Which way a canvas lays its trees out before the reader picks.
		*
		* A fork reads as a descent: the turn being read sits under the inherited turns
		* it came from, and its own branches hang below it. The toolbar switch is how the
		* older left-to-right layout is asked for.
		*/
		const DEFAULT_MAP_DIRECTION = "vertical";
		/**
		* Resolve the Session the app is showing, for one seat.
		*
		* A build that publishes `current` on the list snapshot is trusted first. The
		* 0.1.7 snapshot carries only `{ ids, byId, phase, projectionsBySession }`, so
		* the row the main view retains answers instead — the same derivation every
		* shipped package uses. The seat's own Session is the last resort, which is what
		* a right column bound to a Session reports while nothing holds a main view.
		*
		* Without this the id was simply `undefined`, which silently degraded every
		* "current" answer: no card drew the current ring, and {@link
		* SessionMapView}'s placement and 定位当前 both fell through to fitting the whole
		* graph instead of centering on the Session being read.
		* @param state - the Session list snapshot.
		* @param sessionId - the Session this seat is drawing.
		* @returns the foreground Session id, or `undefined` when none can be named.
		*/
		function foregroundSessionId(state, sessionId) {
			return state.current ?? mainSessionId(state.byId) ?? sessionId;
		}
		/**
		* One overview card.
		* @param key - React key.
		* @param label - the card's caption.
		* @param value - the formatted figure.
		* @returns the card element.
		*/
		function card(key, label, value) {
			return react.createElement("div", {
				className: "dsv-ov__card",
				key
			}, react.createElement("div", { className: "dsv-ov__cardLabel" }, label), react.createElement("div", { className: "dsv-ov__cardValue" }, value));
		}
		/**
		* How many submissions one Session is holding.
		*
		* The current builds publish the list as `pendingSubmissions`; the `queue` field
		* this overview was written against is gone, and reading `.length` off it threw
		* while the overview rendered. Taking whichever field is really an array keeps
		* both builds working and reports "nothing waiting" instead of crashing when
		* neither is present.
		* @param session - the seat's Session snapshot.
		* @returns the number of waiting submissions.
		*/
		function waitingCount(session) {
			if (Array.isArray(session.pendingSubmissions)) return session.pendingSubmissions.length;
			if (Array.isArray(session.queue)) return session.queue.length;
			return 0;
		}
		/**
		* Read everything the overview shows from the seat's props.
		* @param props - composed slot props.
		* @returns the projected title and stats plus the live Session figures.
		*/
		function useOverview(props) {
			return {
				title: props.useProjection("title"),
				stats: props.useProjection("sessionStats"),
				running: props.useSession((s) => s.running),
				queueLength: props.useSession((s) => waitingCount(s)),
				hasMore: props.useSession((s) => s.hasMore)
			};
		}
		/**
		* The overview's title block.
		* @param data - values from {@link useOverview}.
		* @param subtitle - the seat-specific line under the title.
		* @returns the header element.
		*/
		function overviewHead(data, subtitle) {
			return react.createElement("div", null, react.createElement("div", { className: "dsv-ov__head" }, data.title || "未命名会话"), react.createElement("div", { className: "dsv-ov__sub" }, subtitle));
		}
		/**
		* The overview's figure grid.
		* @param data - values from {@link useOverview}.
		* @returns the grid element.
		*/
		function overviewGrid(data) {
			const stats = data.stats;
			return react.createElement("div", { className: "dsv-ov__grid" }, [
				card("turns", "轮次", stats ? formatCount(stats.turns) : "—"),
				card("steps", "步骤", stats ? formatCount(stats.steps) : "—"),
				card("llm", "模型耗时", stats ? formatMs(stats.llmMs) : "—"),
				card("tool", "工具耗时", stats ? formatMs(stats.toolMs) : "—"),
				card("tokens", "输出 token", stats ? formatCount(stats.decodeTokens) : "—"),
				card("state", "状态", data.running ? "运行中" : "空闲")
			]);
		}
		/**
		* The overview's footer: which Session this is and how much history is loaded.
		* @param data - values from {@link useOverview}.
		* @param sessionId - the Session being drawn.
		* @returns the footer element.
		*/
		function overviewFoot(data, sessionId) {
			return react.createElement("div", { className: "dsv-ov__foot" }, "会话 " + String(sessionId) + " · 排队 " + String(data.queueLength) + (data.hasMore ? " · 仍有更早历史未载入" : " · 历史已全部载入"));
		}
		/**
		* One row of the shortcut list behind the keyboard glyph.
		* @param key - the shortcut's key column.
		* @param text - what the shortcut does.
		* @returns the row element.
		*/
		function helpRow(key, text) {
			return react.createElement("div", {
				className: "dsm__helpRow",
				key
			}, react.createElement("span", { className: "dsm__helpKey" }, key), react.createElement("span", { className: "dsm__helpText" }, text));
		}
		/**
		* One option of a two-option toolbar switch.
		* @param label - the option's caption.
		* @param active - whether this option is the one in force.
		* @param title - the tooltip that spells the option out.
		* @param onClick - selects this option.
		* @returns the option button.
		*/
		function segmentOption(label, active, title, onClick) {
			return react.createElement("button", {
				key: label,
				type: "button",
				className: "dsm__segBtn",
				"data-active": active ? "true" : "false",
				"aria-pressed": active ? "true" : "false",
				title,
				onClick
			}, label);
		}
		/**
		* Open one right-sidebar tab type.
		* @param runtime - the plugin's live service accessors.
		* @param kind - the tab kind to open.
		*/
		function openInRightbar(runtime, kind) {
			runtime.sidebarRight().openTab(kind);
		}
		/**
		* Whether the right column is drawing the map right now.
		*
		* Asked before a jump, where it is the user's intent for this navigation; after
		* the switch the same question is about the target Session's own layout.
		* @param runtime - the plugin's live service accessors.
		* @returns true while the map is the active tab.
		*/
		function sidebarShowsMap(runtime) {
			try {
				return runtime.sidebarRight().active()?.kind === MAP_KIND;
			} catch {
				return false;
			}
		}
		/**
		* Re-open the map in the Session a jump just switched to.
		*
		* The controller acts on whichever Session surface is bound, and the switch
		* rebinds it asynchronously, so opening immediately would land in the Session
		* being left. While that one is still bound its column is drawing the map, so
		* waiting for the map to disappear is what proves the target's own layout — the
		* per-Session seed — is in place. A target that already has the map open never
		* satisfies that test and is left as it is.
		* @param runtime - the plugin's live service accessors.
		*/
		function followMapIntoNextSession(runtime) {
			let attempts = 0;
			const tick = () => {
				attempts += 1;
				try {
					const sidebarRight = runtime.sidebarRight();
					if (sidebarRight.active()?.kind !== "session-map") {
						sidebarRight.openTab(MAP_KIND);
						return;
					}
				} catch {}
				if (attempts < 20) window.requestAnimationFrame(tick);
			};
			window.requestAnimationFrame(tick);
		}
		/**
		* The right column's own copy of the overview: same figures, panel spacing, and
		* no way to open a second copy of what is already on screen.
		* @param props - composed slot props.
		* @returns the panel body.
		*/
		function SidebarOverviewBody(props) {
			const data = useOverview(props);
			return react.createElement("div", { className: "dsv-ov dsv-ov--panel" }, overviewHead(data, "sidebar.right.pane.tab · 由动态 Cordis 插件注册"), overviewGrid(data), overviewFoot(data, props.sessionId));
		}
		/**
		* Build the Conversation tab's overview body.
		* @param runtime - the plugin's live service accessors.
		* @returns the registered body component.
		*/
		function createOverviewTab(runtime) {
			function OverviewTab(props) {
				const data = useOverview(props);
				const [error, setError] = react.useState(null);
				const onClick = () => {
					try {
						openInRightbar(runtime, OVERVIEW_KIND);
						setError(null);
					} catch (cause) {
						setError(errorText(cause));
					}
				};
				return react.createElement("div", { className: "dsv-ov" }, overviewHead(data, "对话视图；同样的内容可在右侧栏作为独立标签页打开"), overviewGrid(data), react.createElement("div", { className: "dsv-ov__actions" }, react.createElement("button", {
					type: "button",
					className: "dsv-ov__button",
					onClick
				}, "在右侧栏打开"), error === null ? null : react.createElement("span", { className: "dsv-ov__error" }, error)), overviewFoot(data, props.sessionId));
			}
			return OverviewTab;
		}
		/**
		* Build the Session header's launcher button.
		*
		* The tab row cannot host a launcher: every conversation.view cell IS a View,
		* and the header's tab button calls selectView(id) unconditionally. A View also
		* cannot read the previously selected id (that lives in ui-conversation's
		* private store), so it cannot bounce back precisely. A header utility is a
		* real button and leaves the View selection alone. It toggles instead of only
		* opening: `active()` reports the tab the active pane is drawing, and
		* TabRecord.kind names its type, so "the map is the active tab" is decidable
		* without any extra state.
		* @param runtime - the plugin's live service accessors.
		* @returns the registered header utility component.
		*/
		function createMapLauncher(runtime) {
			function MapLauncher() {
				const [error, setError] = react.useState(null);
				const onClick = () => {
					try {
						const sidebarRight = runtime.sidebarRight();
						const active = sidebarRight.active();
						if (active !== void 0 && active.kind === "session-map") {
							sidebarRight.close(active.id);
							setError(null);
							return;
						}
						sidebarRight.openTab(MAP_KIND);
						setError(null);
					} catch (cause) {
						const message = errorText(cause);
						console.error("会话图谱：切换右侧栏失败", message);
						setError(message);
					}
				};
				return react.createElement("span", { className: "dsm-launchWrap" }, react.createElement("button", {
					type: "button",
					className: "dsm-launch",
					title: "在右侧栏打开或关闭会话图谱",
					onClick
				}, "会话图谱"), error === null ? null : react.createElement("span", { className: "dsm__error" }, error));
			}
			return MapLauncher;
		}
		/**
		* Join one user message's text blocks into a single line. Images and other
		* non-text blocks contribute nothing; a text-less message stays an empty node.
		* @param content - the event message's content blocks, as wire data.
		* @returns the space-joined text.
		*/
		function messageText(content) {
			if (!Array.isArray(content)) return "";
			let text = "";
			for (const block of content) {
				if (typeof block !== "object" || block === null) continue;
				const record = block;
				if (record.type !== "text" || typeof record.text !== "string") continue;
				text += text === "" ? record.text : " " + record.text;
			}
			return text;
		}
		/**
		* Extract every human `user/message` from a loaded Session event window, in
		* order. System prompts, injected context, and assistant events never become
		* nodes.
		* @param entries - the retained Session's event-window entries.
		* @returns the human messages, bound for {@link buildGraph}.
		*/
		function userMessagesOf(entries) {
			const messages = [];
			for (const entry of entries) {
				if (entry.type !== "event") continue;
				const event = entry.event;
				if (event === void 0 || event.type !== "user/message") continue;
				const data = event.data;
				if (typeof data !== "object" || data === null) continue;
				const source = data.source;
				if (typeof source !== "object" || source === null) continue;
				if (source.kind !== "user") continue;
				messages.push({
					seq: event.seq,
					text: messageText(data.content)
				});
			}
			return messages;
		}
		/**
		* The current Session and its ancestor chain, nearest first. The client event
		* window is loaded only for Sessions the app has opened; this path is small and
		* is where the canvas most needs steering inputs (the current tree).
		* @param current - the foreground Session id, when one is known.
		* @param byId - listed Session summaries.
		* @returns the path, empty when no foreground Session is known.
		*/
		function ancestorSessionIds(current, byId) {
			if (current === void 0) return [];
			const ids = [];
			const seen = /* @__PURE__ */ new Set();
			let id = current;
			while (id !== void 0 && !seen.has(id)) {
				seen.add(id);
				ids.push(id);
				id = byId[id]?.parentId;
				if (id !== void 0 && byId[id] === void 0) id = void 0;
			}
			return ids;
		}
		/**
		* The Session tag's text: its display title, keeping a distinguishing head and
		* tail when it is long. The full title and the per-canvas ordinal stay in the
		* tooltip and the action menu.
		* @param title - the Session's display title.
		* @param ordinal - the per-canvas Session number.
		* @returns the label rendered in the tag.
		*/
		function sessionTagLabel(title, ordinal) {
			const text = title.trim();
			if (text === "") return "会话" + String(ordinal);
			if (text.length <= 14) return text;
			return text.slice(0, 7) + "…" + text.slice(-4);
		}
		/**
		* Build one canvas body. One implementation, two seats; `showRightbarButton`
		* only hides the explicit "在右侧栏打开" control where the View already IS the
		* right column.
		* @param runtime - the plugin's live service accessors.
		* @param flags - the switches and per-run fold sets the plugin run owns.
		* @param showRightbarButton - whether to offer the "open in the right column" control.
		* @returns the registered canvas component.
		*/
		function createMapView(runtime, flags, showRightbarButton) {
			function SessionMapView(props) {
				const byId = props.useSessions((state) => state.byId);
				const ids = props.useSessions((state) => state.ids);
				const current = props.useSessions((state) => foregroundSessionId(state, props.sessionId));
				const workspaces = props.useWorkspaces((state) => state.items);
				const [scope, setScope] = useFlag(flags.scope);
				const [direction, setDirection] = useFlag(flags.direction);
				const [foldRuns, setFoldRuns] = useFlag(flags.foldRuns);
				const [expandedRuns, setExpandedRuns] = useFlag(flags.expandedRuns);
				const [hideSubagents, setHideSubagents] = useFlag(flags.hideSubagents);
				const [view, setView] = react.useState({
					zoom: BASE_ZOOM,
					x: 28,
					y: 28
				});
				const [drag, setDrag] = react.useState(null);
				const [placed, setPlaced] = react.useState(false);
				const [menuTargetId, setMenuTargetId] = react.useState(null);
				const [helpOpen, setHelpOpen] = react.useState(false);
				const [error, setError] = react.useState(null);
				const [turnMessages, setTurnMessages] = react.useState({});
				const panelRef = react.useRef(null);
				const messagePath = react.useMemo(() => ancestorSessionIds(current ?? props.sessionId, byId), [
					current,
					props.sessionId,
					byId
				]);
				const messagePathKey = messagePath.join("\0");
				react.useEffect(() => {
					const sessions = runtime.sessions?.();
					if (sessions === void 0 || messagePath.length === 0) {
						setTurnMessages({});
						return;
					}
					const references = [];
					const unsubscribes = [];
					const loaded = {};
					let signature = "";
					const publish = () => {
						const next = { ...loaded };
						const nextSignature = messagePath.map((id) => id + ":" + (next[id] ?? []).map((message) => String(message.seq) + ":" + message.text).join("")).join("");
						if (nextSignature === signature) return;
						signature = nextSignature;
						setTurnMessages(next);
					};
					for (const id of messagePath) {
						let reference;
						try {
							reference = sessions.retain(id, { source: "dsh-session-map" });
						} catch {
							continue;
						}
						references.push(reference);
						const source = reference.binding.eventSource;
						let revision;
						let messages = [];
						const read = () => {
							try {
								const snapshot = source.getSnapshot();
								const change = snapshot.change;
								if (snapshot.revision !== void 0 && snapshot.revision === revision) return;
								revision = snapshot.revision;
								if (change?.kind === "append" && change.entries !== void 0) messages = [...messages, ...userMessagesOf(change.entries)];
								else if (change?.kind === "prepend" && change.entries !== void 0) messages = [...userMessagesOf(change.entries), ...messages];
								else if (change?.kind === "settle-assistant") {} else messages = userMessagesOf(snapshot.entries);
								loaded[id] = messages;
							} catch {
								loaded[id] = [];
							}
							publish();
						};
						read();
						unsubscribes.push(source.subscribe(read));
					}
					publish();
					return () => {
						for (const unsubscribe of unsubscribes) unsubscribe();
						for (const reference of references) reference.release();
					};
				}, [messagePathKey, runtime]);
				const scopeSessionId = scope === "current" ? current : void 0;
				const graph = react.useMemo(() => buildGraph(ids, byId, workspaces, hideSubagents, foldRuns, expandedRuns, scopeSessionId, direction, turnMessages), [
					ids,
					byId,
					workspaces,
					hideSubagents,
					foldRuns,
					expandedRuns,
					scopeSessionId,
					direction,
					turnMessages
				]);
				const currentSession = current === void 0 ? void 0 : graph.sessionsById[current];
				const currentPath = react.useMemo(() => new Set(currentSession?.inheritedNodeIds ?? []), [currentSession]);
				const panelSize = () => {
					const element = panelRef.current;
					if (element === null) return {
						width: 900,
						height: 520
					};
					return {
						width: element.clientWidth,
						height: element.clientHeight
					};
				};
				const fit = () => {
					const size = panelSize();
					const scale = clampNumber(Math.min((size.width - 56) / Math.max(graph.width, 1), (size.height - 56) / Math.max(graph.height, 1)), MIN_ZOOM, BASE_ZOOM);
					setView({
						zoom: scale,
						x: (size.width - graph.width * scale) / 2,
						y: (size.height - graph.height * scale) / 2
					});
				};
				const centerOn = (node, zoom) => {
					const size = panelSize();
					setView({
						zoom,
						x: size.width / 2 - (node.x + 100) * zoom,
						y: size.height / 2 - (node.y + 23) * zoom
					});
				};
				const focusCurrent = () => {
					const session = current === void 0 ? void 0 : graph.sessionsById[current];
					const node = session === void 0 ? void 0 : graph.nodes.find((candidate) => candidate.id === session.headNodeId);
					if (node === void 0) {
						fit();
						return;
					}
					centerOn(node, BASE_ZOOM);
				};
				react.useLayoutEffect(() => {
					setPlaced(false);
				}, [
					foldRuns,
					hideSubagents,
					scope,
					direction
				]);
				react.useLayoutEffect(() => {
					if (placed || graph.nodes.length === 0) return;
					setPlaced(true);
					const size = panelSize();
					if (Math.min((size.width - 56) / Math.max(graph.width, 1), (size.height - 56) / Math.max(graph.height, 1)) >= 1.4) fit();
					else focusCurrent();
				});
				react.useEffect(() => {
					const element = panelRef.current;
					if (element === null) return void 0;
					const onWheel = (event) => {
						const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
						event.preventDefault();
						if (event.ctrlKey || event.metaKey) {
							const rect = element.getBoundingClientRect();
							const pointerX = event.clientX - rect.left;
							const pointerY = event.clientY - rect.top;
							const factor = clampNumber(Math.pow(WHEEL_ZOOM_BASE, -event.deltaY * unit), 1 / WHEEL_ZOOM_MAX_STEP, WHEEL_ZOOM_MAX_STEP);
							setView((previous) => {
								const zoom = clampNumber(previous.zoom * factor, MIN_ZOOM, MAX_ZOOM);
								if (zoom === previous.zoom) return previous;
								const ratio = zoom / previous.zoom;
								return {
									zoom,
									x: pointerX - (pointerX - previous.x) * ratio,
									y: pointerY - (pointerY - previous.y) * ratio
								};
							});
							return;
						}
						const sideways = event.shiftKey;
						const across = (sideways && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
						const down = (sideways ? 0 : event.deltaY) * unit;
						if (across === 0 && down === 0) return;
						setView((previous) => ({
							zoom: previous.zoom,
							x: previous.x - across,
							y: previous.y - down
						}));
					};
					element.addEventListener("wheel", onWheel, { passive: false });
					return () => {
						element.removeEventListener("wheel", onWheel);
					};
				}, []);
				const zoomBy = (factor) => {
					setView((previous) => {
						const zoom = clampNumber(previous.zoom * factor, MIN_ZOOM, MAX_ZOOM);
						if (zoom === previous.zoom) return previous;
						const size = panelSize();
						const ratio = zoom / previous.zoom;
						return {
							zoom,
							x: size.width / 2 - (size.width / 2 - previous.x) * ratio,
							y: size.height / 2 - (size.height / 2 - previous.y) * ratio
						};
					});
				};
				const openRun = (runKey) => {
					setExpandedRuns(withMember(expandedRuns, runKey, true));
				};
				const toggleFoldRuns = () => {
					setFoldRuns(!foldRuns);
					setExpandedRuns(/* @__PURE__ */ new Set());
				};
				const onPointerDown = (event) => {
					const target = event.target;
					if (target instanceof Element && target.closest("[data-dsm-hit]") !== null) return;
					if (menuTargetId !== null) setMenuTargetId(null);
					if (helpOpen) setHelpOpen(false);
					event.preventDefault();
					const element = event.currentTarget;
					if (typeof element.setPointerCapture === "function") try {
						element.setPointerCapture(event.pointerId);
					} catch {}
					setDrag({
						pointerX: event.clientX,
						pointerY: event.clientY,
						x: view.x,
						y: view.y
					});
				};
				const onPointerMove = (event) => {
					if (drag === null) return;
					setView({
						zoom: view.zoom,
						x: drag.x + (event.clientX - drag.pointerX),
						y: drag.y + (event.clientY - drag.pointerY)
					});
				};
				const onPointerEnd = () => {
					if (drag !== null) setDrag(null);
				};
				const openHere = () => {
					try {
						openInRightbar(runtime, MAP_KIND);
						setError(null);
					} catch (cause) {
						setError(errorText(cause));
					}
				};
				const menuNode = menuTargetId === null ? void 0 : graph.nodes.find((candidate) => candidate.id === menuTargetId);
				const menuSession = menuNode === void 0 ? void 0 : graph.sessionsById[menuNode.sessionId];
				let menu = null;
				if (menuNode !== void 0 && menuSession !== void 0) {
					const panel = panelSize();
					const zoom = view.zoom;
					let left = view.x + (menuNode.x + 200) * zoom + 10;
					if (left + 184 > panel.width - 8) left = view.x + menuNode.x * zoom - 184 - 10;
					let top = view.y + menuNode.y * zoom;
					if (top + 160 > panel.height - 8) top = panel.height - 160 - 8;
					if (left < 8) left = 8;
					if (top < 8) top = 8;
					const title = menuNode.kind === "turn" ? (menuNode.turn === null ? "" : "#" + String(menuNode.turn) + " ") + (menuNode.prompt === "" ? "(无提示预览)" : menuNode.prompt) : menuSession.title;
					const note = menuNode.kind === "turn" ? current !== void 0 && menuNode.sessionId !== current ? "该轮属于「" + sessionTagLabel(menuSession.title, menuSession.ordinal) + "」（继承轮次）；暂不能定位到具体轮次。" : "暂不能定位到具体轮次。" : menuSession.outlineMissing ? "该会话的轮次投影还没加载。" : menuSession.ownCount === 0 ? "该会话还没有自己的用户输入，只是一个分叉头。" : null;
					const items = [react.createElement("button", {
						key: "jump",
						type: "button",
						className: "dsm__menuItem",
						onClick: () => {
							setMenuTargetId(null);
							const follows = sidebarShowsMap(runtime);
							runtime.openSession(menuSession.id);
							if (follows) followMapIntoNextSession(runtime);
						}
					}, "跳转到该会话")];
					items.push(react.createElement("button", {
						key: "center",
						type: "button",
						className: "dsm__menuItem",
						onClick: () => {
							setMenuTargetId(null);
							centerOn(menuNode, view.zoom);
						}
					}, "在画布中居中"));
					items.push(react.createElement("button", {
						key: "cancel",
						type: "button",
						className: "dsm__menuItem",
						onClick: () => {
							setMenuTargetId(null);
						}
					}, "取消"));
					if (note !== null) items.push(react.createElement("div", {
						key: "note",
						className: "dsm__menuNote"
					}, note));
					menu = react.createElement("div", {
						className: "dsm__menu",
						style: {
							left: left + "px",
							top: top + "px",
							width: "184px"
						},
						onPointerDown: (event) => {
							event.stopPropagation();
						}
					}, react.createElement("div", {
						className: "dsm__menuTitle",
						title
					}, title), items);
				}
				const help = react.createElement("span", { className: "dsm__help" }, react.createElement("button", {
					type: "button",
					className: "dsm__btn dsm__helpBtn",
					"data-open": helpOpen ? "true" : "false",
					title: "操作提示",
					"aria-label": "操作提示",
					"aria-expanded": helpOpen ? "true" : "false",
					onClick: () => {
						setHelpOpen(!helpOpen);
					}
				}, KEYBOARD_GLYPH), helpOpen ? react.createElement("div", { className: "dsm__helpPanel" }, helpRow("滚轮", "上下平移画布"), helpRow("Shift + 滚轮", "左右平移画布"), helpRow("Ctrl / ⌘ + 滚轮", "缩放"), helpRow("拖动空白处", "平移画布"), helpRow("点击轮次节点", "打开该轮操作菜单"), helpRow("点击会话标签 / 会话头", "打开该会话操作菜单"), helpRow("点击 +N 条输入", "展开折叠的直链")) : null);
				const scopeFallback = scope === "current" && graph.nodes.length > 0 && graph.scopeSessionId === void 0;
				const missingOutlineCount = graph.sessions.filter((session) => session.outlineMissing).length;
				const bar = react.createElement("div", { className: "dsm__bar" }, react.createElement("span", { className: "dsm__title" }, "会话图谱"), react.createElement("span", { className: "dsm__meta" }, String(graph.sessionCount) + " 个会话 · " + String(graph.turnCount) + " 个轮次 · " + String(graph.treeCount) + " 棵树 · " + String(Math.round(view.zoom / BASE_ZOOM * 100)) + "%"), react.createElement("span", { className: "dsm__spacer" }), showRightbarButton ? react.createElement("button", {
					type: "button",
					className: "dsm__btn",
					onClick: openHere
				}, "在右侧栏打开") : null, react.createElement("span", {
					className: "dsm__seg",
					role: "group",
					"aria-label": "画布范围"
				}, segmentOption("当前会话树", scope === "current", "只画当前会话所在的那棵会话树：父链、与它并列的分支，以及它们的后代", () => {
					setScope("current");
				}), segmentOption("全部会话", scope === "all", "铺开列表里的全部会话", () => {
					setScope("all");
				})), react.createElement("span", {
					className: "dsm__seg",
					role: "group",
					"aria-label": "树的生长方向"
				}, segmentOption("竖向", direction === "vertical", "会话树自上而下：子轮次在父轮次下方，分叉在两侧展开", () => {
					setDirection("vertical");
				}), segmentOption("横向", direction === "horizontal", "会话树自左向右：子轮次在父轮次右侧", () => {
					setDirection("horizontal");
				})), scopeFallback ? react.createElement("span", { className: "dsm__note" }, "当前会话不在列表里，已显示全部会话") : null, react.createElement("label", {
					className: "dsm__toggle",
					title: "直链超过 " + String(8) + " 条输入时折叠中间段；点击画布上的 +N 条输入可展开"
				}, react.createElement("input", {
					type: "checkbox",
					checked: foldRuns,
					onChange: toggleFoldRuns
				}), "折叠长直链"), react.createElement("label", { className: "dsm__toggle" }, react.createElement("input", {
					type: "checkbox",
					checked: hideSubagents,
					onChange: (event) => {
						setHideSubagents(event.currentTarget.checked);
					}
				}), "隐藏子代理会话"), react.createElement("button", {
					type: "button",
					className: "dsm__btn",
					onClick: () => {
						zoomBy(1 / 1.25);
					}
				}, "−"), react.createElement("button", {
					type: "button",
					className: "dsm__btn",
					onClick: () => {
						zoomBy(1.25);
					}
				}, "+"), react.createElement("button", {
					type: "button",
					className: "dsm__btn",
					onClick: focusCurrent
				}, "定位当前"), react.createElement("button", {
					type: "button",
					className: "dsm__btn",
					onClick: fit
				}, "适应窗口"), react.createElement("button", {
					type: "button",
					className: "dsm__btn",
					onClick: () => {
						zoomBy(BASE_ZOOM / view.zoom);
					}
				}, "100%"), help, missingOutlineCount > 0 ? react.createElement("span", { className: missingOutlineCount === graph.sessionCount ? "dsm__error" : "dsm__note" }, missingOutlineCount === graph.sessionCount ? "列表里没有 turnOutline 投影，只能显示会话头" : String(missingOutlineCount) + " 个会话没有轮次投影，只显示会话头") : null, error === null ? null : react.createElement("span", { className: "dsm__error" }, error));
				const stage = graph.nodes.length === 0 ? react.createElement("div", { className: "dsm__empty" }, scope === "current" && ids.length > 0 ? "当前会话所在的会话树里没有可显示的会话" : "还没有任何会话") : react.createElement("div", {
					className: "dsm__stage",
					style: {
						width: graph.width + "px",
						height: graph.height + "px",
						transform: "translate(" + view.x + "px, " + view.y + "px) scale(" + view.zoom + ")"
					}
				}, react.createElement("svg", {
					className: "dsm__svg",
					width: graph.width,
					height: graph.height
				}, graph.edges.map((edge) => react.createElement("path", {
					key: edge.key,
					d: edge.d,
					className: EDGE_CLASS[edge.kind]
				}))), graph.captions.map((caption) => react.createElement("div", {
					key: caption.key,
					className: "dsm__caption",
					style: {
						left: caption.x + "px",
						top: caption.y + "px"
					}
				}, caption.text)), graph.markers.map((marker) => react.createElement("button", {
					key: marker.id,
					type: "button",
					"data-dsm-hit": "run",
					"data-kind": "run",
					className: "dsm__marker",
					style: {
						left: marker.x + "px",
						top: marker.y + "px",
						width: "96px",
						height: "22px"
					},
					title: "展开这条直链中间的 " + String(marker.count) + " 条用户输入",
					onClick: () => {
						openRun(marker.runKey);
					}
				}, "+ " + String(marker.count) + " 条输入")), graph.nodes.map((node) => {
					const session = graph.sessionsById[node.sessionId];
					if (session === void 0) return null;
					const status = session.running ? "运行中" : session.completed ? "已完成" : "空闲";
					const state = session.running ? "running" : session.completed ? "completed" : "idle";
					const isCurrent = node.sessionId === current;
					const onCurrentPath = !isCurrent && currentPath.has(node.id);
					const hiddenNote = node.hiddenInherited > 0 ? "继承 " + String(node.hiddenInherited) + " 轮（父会话已隐藏）" : "";
					const title = (node.kind === "head" ? [
						session.title,
						"会话" + String(session.ordinal) + " · " + status + (session.subagent ? " · 子代理" : ""),
						session.outlineMissing ? "轮次投影未加载" : "尚无自己的用户输入",
						hiddenNote
					] : [
						(node.turn === null ? "" : "#" + String(node.turn) + " ") + (node.prompt === "" ? "(无提示预览)" : node.prompt),
						node.response,
						"会话" + String(session.ordinal) + " · " + session.title,
						status + (session.subagent ? " · 子代理" : ""),
						node.hiddenInherited > 0 ? hiddenNote : ""
					]).filter((line) => line !== "").join("\n");
					const prompt = node.kind === "head" ? session.outlineMissing ? "投影未加载" : hiddenNote !== "" ? hiddenNote : "尚无输入" : (node.turn === null ? "" : "#" + String(node.turn) + " ") + (node.prompt === "" ? "(无提示预览)" : node.prompt);
					return react.createElement("button", {
						key: node.id,
						type: "button",
						"data-dsm-hit": "node",
						"data-kind": node.kind,
						"data-head": node.isHead ? "true" : "false",
						"data-tone": String(session.tone),
						"data-current": isCurrent ? "true" : "false",
						"data-on-current-path": onCurrentPath ? "true" : "false",
						"data-subagent": session.subagent ? "true" : "false",
						"data-menu": node.id === menuTargetId ? "true" : "false",
						className: "dsm__node",
						style: {
							left: node.x + "px",
							top: node.y + "px",
							width: "200px",
							height: "46px"
						},
						title,
						onClick: () => {
							setMenuTargetId(node.id);
						}
					}, node.isHead ? react.createElement("span", { className: "dsm__tagRow" }, react.createElement("span", {
						className: "dsm__tag",
						title: "会话" + String(session.ordinal) + " · " + session.title
					}, react.createElement("span", {
						className: "dsm__dot",
						"data-state": state
					}), react.createElement("span", { className: "dsm__tagText" }, sessionTagLabel(session.title, session.ordinal))), node.kind === "turn" && hiddenNote !== "" ? react.createElement("span", { className: "dsm__tagNote" }, String(node.hiddenInherited) + " 隐藏") : null) : null, react.createElement("span", { className: "dsm__prompt" }, prompt), node.forkCount > 0 ? react.createElement("span", { className: "dsm__branch" }, String(node.forkCount) + " 分支") : null);
				}));
				return react.createElement("div", { className: "dsm" }, bar, react.createElement("div", {
					className: "dsm__panel",
					"data-dragging": drag === null ? "false" : "true",
					ref: panelRef,
					onPointerDown,
					onPointerMove,
					onPointerUp: onPointerEnd,
					onPointerCancel: onPointerEnd
				}, stage, menu));
			}
			return SessionMapView;
		}
		//#endregion
		//#region src/client/index.ts
		/** Plugin name the Loader reports for this bundle's browser half. */
		const name = "dsh-session-map";
		/** Hard dependency: there is nothing to register into before the slot registry exists. */
		const inject = ["slots"];
		/**
		* Read one optional service from the global store.
		*
		* The context's declared surface carries none of these prerelease services, so
		* the lookup is typed here instead of imported; `undefined` means nothing is
		* providing the name right now.
		* @param ctx - the plugin's context.
		* @param name - the service name.
		* @returns the service as the caller's local interface, or `undefined`.
		*/
		function lookup(ctx, name) {
			return ctx.get(name);
		}
		/**
		* Browser-local preference holding whether the Conversation tab entries are
		* registered.
		*
		* Not row config: the browser half is created by the web boot with a bare
		* `{ name }` (`packages/client/web/src/boot-client.ts`), and a boot manifest
		* row carries only `id`, `inject`, and `immediately`, so nothing a profile
		* writes reaches this program.
		*/
		const CONVERSATION_VIEWS_KEY = "dsh.session-map.conversationViews";
		/**
		* Whether the Conversation tabs are registered when this browser recorded no
		* preference. The header launcher and both right-column tab types register
		* either way, so the map stays usable from the right column alone.
		*/
		const DEFAULT_CONVERSATION_VIEWS = false;
		/**
		* Read this browser's Conversation-tab preference.
		* @returns true when the tabs should be registered.
		*/
		function conversationViewsEnabled() {
			if (typeof localStorage === "undefined") return DEFAULT_CONVERSATION_VIEWS;
			try {
				const stored = localStorage.getItem(CONVERSATION_VIEWS_KEY);
				if (stored === "true") return true;
				if (stored === "false") return false;
			} catch {}
			return DEFAULT_CONVERSATION_VIEWS;
		}
		/**
		* Client plugin body: inject the stylesheet, build the three bodies over one set
		* of plugin-run switches, and register every seat and tab type.
		* @param ctx - browser root context carrying the slot registry.
		*/
		function apply(ctx) {
			const slots = lookup(ctx, "slots");
			if (slots === void 0) return;
			ctx.effect(() => {
				const element = document.createElement("style");
				element.textContent = CSS;
				document.head.appendChild(element);
				return () => {
					element.remove();
				};
			}, "session-views: stylesheet");
			const flags = {
				scope: createFlag(DEFAULT_MAP_SCOPE),
				direction: createFlag(DEFAULT_MAP_DIRECTION),
				foldRuns: createFlag(true),
				expandedRuns: createFlag(/* @__PURE__ */ new Set()),
				hideSubagents: createFlag(true)
			};
			const runtime = {
				sidebarRight: () => {
					const service = lookup(ctx, "sidebarRight");
					if (service === void 0) throw new Error("右侧栏服务 sidebarRight 不可用");
					return service;
				},
				openSession: (sessionId) => {
					const uiWorkspace = lookup(ctx, "uiWorkspace");
					if (uiWorkspace !== void 0 && typeof uiWorkspace.openSession === "function") {
						uiWorkspace.openSession(sessionId);
						return;
					}
					const sessions = lookup(ctx, "sessions");
					if (sessions !== void 0 && typeof sessions.open === "function") sessions.open(sessionId);
				},
				sessions: () => lookup(ctx, "sessions")
			};
			const MapLauncher = createMapLauncher(runtime);
			const OverviewTab = createOverviewTab(runtime);
			const SessionMapTab = createMapView(runtime, flags, true);
			const SidebarMapBody = createMapView(runtime, flags, false);
			ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register({
				name: "conversation.session.header.utilities",
				id: "session-map-launcher",
				order: 40
			}, MapLauncher)), "session-map: header launcher");
			if (conversationViewsEnabled()) {
				ctx.effect(() => slots.inject("conversation.view", () => slots.register({
					name: "conversation.view",
					id: "session-overview",
					order: 20,
					label: "概览"
				}, OverviewTab)), "session-overview: conversation view entry");
				ctx.effect(() => slots.inject("conversation.view", () => slots.register({
					name: "conversation.view",
					id: "session-map",
					order: 30,
					label: "会话图谱"
				}, SessionMapTab)), "session-map: conversation view entry");
			}
			ctx.inject(["slots", "sidebarRightTabs"], (scope) => {
				const scopedSlots = lookup(scope, "slots");
				const sidebarRightTabs = lookup(scope, "sidebarRightTabs");
				if (scopedSlots === void 0 || sidebarRightTabs === void 0) return;
				const claimType = (id, kind, title, guideTitle, guideDescription) => {
					return () => {
						const existing = sidebarRightTabs.get(kind);
						if (existing !== void 0) {
							if (existing.id === id) return () => {};
							throw new Error("sidebarRight: kind \"" + kind + "\" is already held by tab type \"" + existing.id + "\"");
						}
						const definition = guideTitle === void 0 ? {
							id,
							kind,
							title
						} : {
							id,
							kind,
							title,
							guide: [{
								order: 20,
								title: guideTitle,
								description: guideDescription
							}]
						};
						return sidebarRightTabs.register(definition);
					};
				};
				ctx.effect(claimType(OVERVIEW_TYPE_ID, OVERVIEW_KIND, () => "会话概览"), "session-overview: rightbar tab type");
				ctx.effect(() => scopedSlots.inject("sidebar.right.pane.tab", () => scopedSlots.register({
					name: "sidebar.right.pane.tab",
					key: OVERVIEW_TYPE_ID
				}, SidebarOverviewBody)), "session-overview: rightbar tab body");
				ctx.effect(claimType(MAP_TYPE_ID, MAP_KIND, () => "会话图谱", () => "会话图谱", () => "所有会话的轮次树画布"), "session-map: rightbar tab type");
				ctx.effect(() => scopedSlots.inject("sidebar.right.pane.tab", () => scopedSlots.register({
					name: "sidebar.right.pane.tab",
					key: MAP_TYPE_ID
				}, SidebarMapBody)), "session-map: rightbar tab body");
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map