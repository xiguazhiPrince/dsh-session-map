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
`;
		//#endregion
		//#region src/client/constants.ts
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
		const OVERVIEW_KIND = "session-overview";
		/** Tab-type id the overview body registers under. */
		const OVERVIEW_TYPE_ID = "dsh-session-map.overview";
		/** Kind (the `openTab` discriminator) of the fork-tree canvas page. */
		const MAP_KIND = "session-map";
		/** Tab-type id the canvas body registers under. */
		const MAP_TYPE_ID = "dsh-session-map.map";
		/** Lowest canvas scale the toolbar and the wheel will reach. */
		const MIN_ZOOM = .15;
		/** Canvas scale the toolbar reports as 100%. */
		const BASE_ZOOM = 1.4;
		/** Highest canvas scale the toolbar and the wheel will reach. */
		const MAX_ZOOM = 2.8;
		/** Stylesheet class per wire kind. */
		const EDGE_CLASS = {
			branch: "dsm__edge",
			sub: "dsm__edge dsm__edge--sub",
			wire: "dsm__edge dsm__edge--wire"
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
		* Canvas construction: the fork tree over every listed Session, the outgoing
		* wire each Session's turns are threaded on, and the fold capsules that stand
		* in for turns shown elsewhere.
		*
		* Everything here is a pure function of the listed Sessions, the Workspace
		* membership, and the line/fold switches, so equal inputs always produce an
		* equal layout and the Views can rebuild it on every render.
		*
		* @module dsh-session-map/client/graph
		*/
		/** The label a Session card shows: its projected title, or its id when it has none. */
		function sessionLabel(summary, id) {
			const title = summary.displayTitle;
			if (typeof title === "string" && title !== "") return title;
			return String(id);
		}
		/** One turn's compared identity: the two bounded previews the Host projected. */
		function previewOf(entry) {
			const record = typeof entry === "object" && entry !== null ? entry : void 0;
			const prompt = record === void 0 ? void 0 : record.prompt;
			const response = record === void 0 ? void 0 : record.response;
			return {
				prompt: typeof prompt === "string" ? prompt : "",
				response: typeof response === "string" ? response : ""
			};
		}
		/** Whether two outlines carry the same turn at one position. */
		function sameTurn(left, right) {
			if (left === void 0 || right === void 0) return false;
			return left.prompt === right.prompt && left.response === right.response;
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
		/** The bezier joining one card's wire end to a child card's left edge. */
		function edgePath(from, to) {
			const x1 = from.outX;
			const y1 = from.y + 23;
			const x2 = to.x;
			const y2 = to.y + 23;
			const bend = Math.max(18, (x2 - x1) / 2);
			return "M " + x1 + " " + y1 + " C " + (x1 + bend) + " " + y1 + " " + (x2 - bend) + " " + y2 + " " + x2 + " " + y2;
		}
		/**
		* Build the canvas: nodes, their wire, the turn beads, and the fold markers.
		* @param ids - listed Session ids in host order.
		* @param byId - listed Session summaries.
		* @param workspaces - Workspace membership, for tree order and captions.
		* @param hideSubagents - whether subagent-origin Sessions are filtered out.
		* @param lines - global bead switch plus each per-line override set.
		* @param expandedInherited - Session ids whose inherited prefix is expanded.
		* @returns the positioned graph.
		*/
		function buildGraph(ids, byId, workspaces, hideSubagents, lines, expandedInherited) {
			const nodes = {};
			const ordered = [];
			const outlines = {};
			let outlineCount = 0;
			for (const id of ids) {
				const summary = byId[id];
				if (summary === void 0) continue;
				if (hideSubagents && summary.origin === "subagent") continue;
				const node = {
					id,
					title: sessionLabel(summary, id),
					parentId: summary.parentId,
					running: summary.running === true,
					completed: summary.completed === true,
					subagent: summary.origin === "subagent",
					beadCount: 0,
					inheritedCount: 0,
					turnsOpen: false,
					updatedAt: typeof summary.updatedAt === "number" ? summary.updatedAt : 0,
					childCount: 0,
					row: 0,
					x: 0,
					y: 0,
					outX: 0
				};
				nodes[id] = node;
				ordered.push(node);
				const outline = outlineOf(summary);
				if (outline === void 0) continue;
				outlines[id] = outline.map(previewOf);
				node.beadCount = outline.length;
				outlineCount += outline.length;
			}
			for (const node of ordered) {
				const id = node.id;
				const summary = byId[id];
				const own = outlines[id];
				const parentId = summary === void 0 ? void 0 : summary.parentId;
				if (own === void 0 || parentId === void 0) continue;
				const parentOutline = outlines[parentId];
				if (parentOutline === void 0) continue;
				let shared = 0;
				while (shared < own.length && shared < parentOutline.length && sameTurn(own[shared], parentOutline[shared])) shared += 1;
				node.inheritedCount = shared;
			}
			for (const node of ordered) node.turnsOpen = lines.global ? !lines.collapsed.has(node.id) : lines.opened.has(node.id);
			const hostingParent = (node) => {
				const seen = {};
				seen[node.id] = true;
				let parentId = node.parentId;
				while (parentId !== void 0) {
					if (seen[parentId] === true) return void 0;
					seen[parentId] = true;
					if (nodes[parentId] !== void 0) return parentId;
					const parent = byId[parentId];
					if (parent === void 0) return void 0;
					parentId = parent.parentId;
				}
			};
			const childrenOf = {};
			const roots = [];
			for (const node of ordered) {
				const parentId = hostingParent(node);
				if (parentId === void 0) {
					roots.push(node);
					continue;
				}
				node.parentId = parentId;
				const siblings = childrenOf[parentId];
				if (siblings === void 0) childrenOf[parentId] = [node];
				else siblings.push(node);
				const parent = nodes[parentId];
				if (parent !== void 0) parent.childCount += 1;
			}
			const groupRank = {};
			for (const [group, workspace] of workspaces.entries()) for (const member of workspace.sessionIds) if (groupRank[member] === void 0) groupRank[member] = group;
			const rankOf = (id) => {
				const rank = groupRank[id];
				return rank === void 0 ? workspaces.length : rank;
			};
			roots.sort((left, right) => {
				const groupLeft = rankOf(left.id);
				const groupRight = rankOf(right.id);
				if (groupLeft !== groupRight) return groupLeft - groupRight;
				if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
				return left.id < right.id ? -1 : 1;
			});
			const children = (id) => {
				const kids = childrenOf[id];
				return kids === void 0 ? [] : kids;
			};
			const edges = [];
			const captions = [];
			const beads = [];
			const markers = [];
			let cursorY = 0;
			let width = 0;
			for (let index = 0; index < roots.length; index += 1) {
				const root = roots[index];
				if (root === void 0) continue;
				const visited = {};
				const collected = [];
				let rowCursor = 0;
				const walk = (node) => {
					if (visited[node.id] === true) return;
					visited[node.id] = true;
					collected.push(node);
					const kids = children(node.id).filter((kid) => visited[kid.id] !== true);
					if (kids.length === 0) {
						node.row = rowCursor;
						rowCursor += 1;
						return;
					}
					for (const kid of kids) walk(kid);
					const first = kids[0];
					const last = kids[kids.length - 1];
					node.row = first !== void 0 && last !== void 0 ? (first.row + last.row) / 2 : node.row;
				};
				walk(root);
				const top = cursorY + 24;
				for (const node of collected) {
					const parent = node.parentId === void 0 ? void 0 : nodes[node.parentId];
					node.x = parent === void 0 ? 28 : parent.outX + 56;
					node.y = top + node.row * 62;
					let right = node.x + 200;
					const outline = outlines[node.id];
					if (outline !== void 0 && outline.length > 0) {
						const beadY = node.y + 23 - 11;
						let cursor = right + 22;
						markers.push({
							id: node.id + "::line",
							kind: "line",
							sessionId: node.id,
							x: cursor,
							y: beadY,
							count: outline.length,
							open: node.turnsOpen
						});
						cursor += 104;
						right = cursor - 8;
						if (node.turnsOpen) {
							const foldInherited = node.inheritedCount > 0;
							const inheritedOpen = foldInherited && expandedInherited.has(node.id);
							let from = 0;
							if (foldInherited) {
								markers.push({
									id: node.id + "::fold",
									kind: "fold",
									sessionId: node.id,
									x: cursor,
									y: beadY,
									count: node.inheritedCount,
									open: inheritedOpen
								});
								cursor += 104;
								right = cursor - 8;
								if (!inheritedOpen) from = node.inheritedCount;
							}
							for (let turn = from; turn < outline.length; turn += 1) {
								const preview = outline[turn];
								const prompt = preview === void 0 ? "" : preview.prompt;
								beads.push({
									id: String(node.id) + "::turn::" + String(turn),
									owner: node.id,
									ordinal: turn + 1,
									x: cursor,
									y: beadY,
									title: turn + 1 + ". " + (prompt === "" ? "(无提示预览)" : prompt)
								});
								cursor += 128;
								right = cursor - 8;
							}
						}
					}
					node.outX = right;
					if (node.outX > width) width = node.outX;
				}
				for (const node of collected) {
					if (node.outX > node.x + 200) {
						const cy = node.y + 23;
						edges.push({
							key: node.id + ">wire",
							kind: "wire",
							d: "M " + (node.x + 200) + " " + cy + " L " + node.outX + " " + cy
						});
					}
					for (const kid of children(node.id)) {
						if (visited[kid.id] !== true) continue;
						edges.push({
							key: node.id + ">" + kid.id,
							kind: kid.subagent ? "sub" : "branch",
							d: edgePath(node, kid)
						});
					}
				}
				const owner = workspaces.find((item) => item.sessionIds.indexOf(root.id) >= 0);
				const ownerTitle = owner === void 0 ? "" : String(owner.title || owner.path);
				captions.push({
					key: "caption-" + root.id,
					x: 28,
					y: cursorY,
					text: "会话树 " + (index + 1) + (ownerTitle === "" ? " · 未归属工作区" : " · " + ownerTitle)
				});
				cursorY = top + rowCursor * 62 - 16 + 36;
			}
			return {
				nodes: ordered,
				beads,
				markers,
				edges,
				captions,
				sessionCount: ordered.length,
				outlineCount,
				openCount: markers.filter((marker) => marker.kind === "line" && marker.open).length,
				width: width + 56,
				height: Math.max(cursorY - 36, 0) + 56,
				treeCount: roots.length
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
		* right-column tab), the launcher button, and the fork-tree canvas factory.
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
		* Read everything the overview shows from the seat's props.
		* @param props - composed slot props.
		* @returns the projected title and stats plus the live Session figures.
		*/
		function useOverview(props) {
			return {
				title: props.useProjection("title"),
				stats: props.useProjection("sessionStats"),
				running: props.useSession((s) => s.running),
				queueLength: props.useSession((s) => s.queue.length),
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
		* Open one right-sidebar tab type.
		* @param runtime - the plugin's live service accessors.
		* @param kind - the tab kind to open.
		*/
		function openInRightbar(runtime, kind) {
			runtime.sidebarRight().openTab(kind);
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
				const onClick = () => {
					try {
						const sidebarRight = runtime.sidebarRight();
						const active = sidebarRight.active();
						if (active !== void 0 && active.kind === "session-map") {
							sidebarRight.close(active.id);
							return;
						}
						sidebarRight.openTab(MAP_KIND);
					} catch (cause) {
						console.error("会话图谱：切换右侧栏失败", errorText(cause));
					}
				};
				return react.createElement("button", {
					type: "button",
					className: "dsm-launch",
					title: "在右侧栏打开或关闭会话图谱",
					onClick
				}, "会话图谱");
			}
			return MapLauncher;
		}
		/**
		* Build one canvas body. One implementation, two seats; `showRightbarButton`
		* only hides the explicit "在右侧栏打开" control where the View already IS the
		* right column.
		* @param runtime - the plugin's live service accessors.
		* @param flags - the switches and per-line sets the plugin run owns.
		* @param showRightbarButton - whether to offer the "open in the right column" control.
		* @returns the registered canvas component.
		*/
		function createMapView(runtime, flags, showRightbarButton) {
			function SessionMapView(props) {
				const byId = props.useSessions((state) => state.byId);
				const ids = props.useSessions((state) => state.ids);
				const current = props.useSessions((state) => state.current);
				const workspaces = props.useWorkspaces((state) => state.items);
				const [hideSubagents, setHideSubagents] = useFlag(flags.hideSubagents);
				const [showPrompts, setShowPrompts] = useFlag(flags.showPrompts);
				const [openedLines, setOpenedLines] = useFlag(flags.openedLines);
				const [collapsedLines, setCollapsedLines] = useFlag(flags.collapsedLines);
				const [expandedInherited, setExpandedInherited] = useFlag(flags.expandedInherited);
				const [view, setView] = react.useState({
					zoom: BASE_ZOOM,
					x: 28,
					y: 28
				});
				const [drag, setDrag] = react.useState(null);
				const [placed, setPlaced] = react.useState(false);
				const [menuTarget, setMenuTarget] = react.useState(null);
				const [helpOpen, setHelpOpen] = react.useState(false);
				const [error, setError] = react.useState(null);
				const panelRef = react.useRef(null);
				const graph = buildGraph(ids, byId, workspaces, hideSubagents, {
					global: showPrompts,
					opened: openedLines,
					collapsed: collapsedLines
				}, expandedInherited);
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
					const node = graph.nodes.find((candidate) => candidate.id === current);
					if (node === void 0) {
						fit();
						return;
					}
					centerOn(node, BASE_ZOOM);
				};
				react.useEffect(() => {
					setPlaced(false);
				}, [showPrompts, hideSubagents]);
				react.useEffect(() => {
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
							const factor = Math.pow(1.0015, -event.deltaY * unit);
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
				const setLineOpen = (sessionId, open) => {
					if (showPrompts) {
						setCollapsedLines(withMember(collapsedLines, sessionId, !open));
						return;
					}
					setOpenedLines(withMember(openedLines, sessionId, open));
				};
				const toggleInherited = (sessionId) => {
					setExpandedInherited(withMember(expandedInherited, sessionId, !expandedInherited.has(sessionId)));
				};
				const onPointerDown = (event) => {
					const target = event.target;
					if (target instanceof Element && target.closest("[data-dsm-hit]") !== null) return;
					if (menuTarget !== null) setMenuTarget(null);
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
				const menuTargetId = menuTarget === null ? null : menuTarget.id;
				const menuNode = menuTarget !== null && menuTarget.kind === "node" ? graph.nodes.find((candidate) => candidate.id === menuTargetId) : void 0;
				const menuBead = menuTarget !== null && menuTarget.kind === "bead" ? graph.beads.find((candidate) => candidate.id === menuTargetId) : void 0;
				const menuAnchor = menuNode !== void 0 ? {
					x: menuNode.x,
					y: menuNode.y,
					w: 200,
					h: 46,
					title: menuNode.title,
					sessionId: menuNode.id
				} : menuBead !== void 0 ? {
					x: menuBead.x,
					y: menuBead.y,
					w: 120,
					h: 22,
					title: menuBead.title,
					sessionId: menuBead.owner
				} : void 0;
				let menu = null;
				if (menuAnchor !== void 0) {
					const panel = panelSize();
					const zoom = view.zoom;
					const box = menuAnchor;
					let left = view.x + (box.x + box.w) * zoom + 10;
					if (left + 184 > panel.width - 8) left = view.x + box.x * zoom - 184 - 10;
					let top = view.y + box.y * zoom;
					if (top + 118 > panel.height - 8) top = panel.height - 118 - 8;
					if (left < 8) left = 8;
					if (top < 8) top = 8;
					const items = [react.createElement("button", {
						key: "jump",
						type: "button",
						className: "dsm__menuItem",
						onClick: () => {
							setMenuTarget(null);
							runtime.openSession(box.sessionId);
						}
					}, "跳转到该会话")];
					if (menuNode !== void 0) items.push(react.createElement("button", {
						key: "center",
						type: "button",
						className: "dsm__menuItem",
						onClick: () => {
							setMenuTarget(null);
							centerOn(menuNode, view.zoom);
						}
					}, "在画布中居中"));
					items.push(react.createElement("button", {
						key: "cancel",
						type: "button",
						className: "dsm__menuItem",
						onClick: () => {
							setMenuTarget(null);
						}
					}, "取消"));
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
						title: box.title
					}, box.title), items, menuBead === void 0 ? null : react.createElement("div", { className: "dsm__menuNote" }, "当前只能定位到会话，不能定位到具体轮次。"));
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
				}, KEYBOARD_GLYPH), helpOpen ? react.createElement("div", { className: "dsm__helpPanel" }, helpRow("滚轮", "上下平移画布"), helpRow("Shift + 滚轮", "左右平移画布"), helpRow("Ctrl / ⌘ + 滚轮", "缩放"), helpRow("拖动空白处", "平移画布"), helpRow("点击节点", "打开操作菜单"), helpRow("点击链首标记", "展开 / 收起该线输入"), helpRow("点击输入珠子", "打开该轮的操作")) : null);
				const bar = react.createElement("div", { className: "dsm__bar" }, react.createElement("span", { className: "dsm__title" }, "会话图谱"), react.createElement("span", { className: "dsm__meta" }, String(graph.sessionCount) + " 个会话 · " + String(graph.treeCount) + " 棵树" + (graph.outlineCount > 0 ? " · " + String(graph.openCount) + "/" + String(graph.sessionCount) + " 条线展开" : "") + " · " + String(Math.round(view.zoom / BASE_ZOOM * 100)) + "%"), react.createElement("span", { className: "dsm__spacer" }), showRightbarButton ? react.createElement("button", {
					type: "button",
					className: "dsm__btn",
					onClick: openHere
				}, "在右侧栏打开") : null, react.createElement("label", {
					className: "dsm__toggle",
					title: "一次铺开所有会话的用户输入；关闭后可以逐条线单独展开"
				}, react.createElement("input", {
					type: "checkbox",
					checked: showPrompts,
					onChange: () => {
						setShowPrompts(!showPrompts);
					}
				}), "全局显示用户输入"), react.createElement("label", { className: "dsm__toggle" }, react.createElement("input", {
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
				}, "100%"), help, showPrompts && graph.outlineCount === 0 ? react.createElement("span", { className: "dsm__error" }, "列表里没有 turnOutline 投影，读不到用户输入") : null, error === null ? null : react.createElement("span", { className: "dsm__error" }, error));
				const stage = graph.nodes.length === 0 ? react.createElement("div", { className: "dsm__empty" }, "还没有任何会话") : react.createElement("div", {
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
				}, caption.text)), graph.beads.map((bead) => react.createElement("button", {
					key: bead.id,
					type: "button",
					"data-dsm-hit": "bead",
					"data-menu": bead.id === menuTargetId ? "true" : "false",
					className: "dsm__bead",
					style: {
						left: bead.x + "px",
						top: bead.y + "px",
						width: "120px",
						height: "22px"
					},
					title: bead.title,
					onClick: () => {
						setMenuTarget({
							kind: "bead",
							id: bead.id
						});
					}
				}, bead.title)), graph.markers.map((marker) => react.createElement("button", {
					key: marker.id,
					type: "button",
					"data-dsm-hit": marker.kind,
					"data-kind": marker.kind,
					className: "dsm__marker",
					style: {
						left: marker.x + "px",
						top: marker.y + "px",
						width: "96px",
						height: "22px"
					},
					title: marker.kind === "line" ? marker.open ? "收起这条线的 " + String(marker.count) + " 轮用户输入" : "展开这条线的 " + String(marker.count) + " 轮用户输入" : "前 " + String(marker.count) + " 轮继承自父会话，已显示在父会话的链上。" + (marker.open ? "点击折叠" : "点击展开"),
					onClick: () => {
						if (marker.kind === "line") setLineOpen(marker.sessionId, !marker.open);
						else toggleInherited(marker.sessionId);
					}
				}, (marker.open ? "− " : "+ ") + String(marker.count) + (marker.kind === "line" ? " 输入" : " 继承"))), graph.nodes.map((node) => react.createElement("button", {
					key: node.id,
					type: "button",
					"data-dsm-hit": "node",
					"data-current": node.id === current ? "true" : "false",
					"data-subagent": node.subagent ? "true" : "false",
					"data-menu": node.id === menuTargetId ? "true" : "false",
					className: "dsm__node",
					style: {
						left: node.x + "px",
						top: node.y + "px",
						width: "200px",
						height: "46px"
					},
					title: node.title,
					onClick: () => {
						setMenuTarget({
							kind: "node",
							id: node.id
						});
					}
				}, react.createElement("span", { className: "dsm__nodeTitle" }, node.title), react.createElement("span", { className: "dsm__nodeMeta" }, react.createElement("span", {
					className: "dsm__dot",
					"data-state": node.running ? "running" : node.completed ? "completed" : "idle"
				}), node.running ? "运行中" : node.completed ? "已完成" : "空闲", node.childCount > 0 ? " · " + node.childCount + " 分支" : "", node.subagent ? " · 子代理" : "", node.inheritedCount > 0 ? " · 继承 " + node.inheritedCount : ""))));
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
				showPrompts: createFlag(false),
				hideSubagents: createFlag(true),
				openedLines: createFlag(/* @__PURE__ */ new Set()),
				collapsedLines: createFlag(/* @__PURE__ */ new Set()),
				expandedInherited: createFlag(/* @__PURE__ */ new Set())
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
				}
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
			const sidebarRightTabs = lookup(ctx, "sidebarRightTabs");
			if (sidebarRightTabs === void 0) return;
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
			ctx.effect(() => slots.inject("sidebar.right.pane.tab", () => slots.register({
				name: "sidebar.right.pane.tab",
				key: OVERVIEW_TYPE_ID
			}, SidebarOverviewBody)), "session-overview: rightbar tab body");
			ctx.effect(claimType(MAP_TYPE_ID, MAP_KIND, () => "会话图谱", () => "会话图谱", () => "所有会话的 fork 树画布"), "session-map: rightbar tab type");
			ctx.effect(() => slots.inject("sidebar.right.pane.tab", () => slots.register({
				name: "sidebar.right.pane.tab",
				key: MAP_TYPE_ID
			}, SidebarMapBody)), "session-map: rightbar tab body");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map