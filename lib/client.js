window.__ModuleLoader__.load({
	id: "@xiguazhiprince/dsh-session-map",
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
		//#region src/session-map/format.ts
		/**
		* Display formatters for the overview figures and the toolbar.
		*
		* Every formatter is total over `unknown`: the values reach a plugin as Host
		* projection wire data, so a missing or mistyped field renders as the dash
		* rather than breaking a card.
		*
		* @module dsh-session-map/session-map/format
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
		function errorText$3(cause) {
			const message = typeof cause === "object" && cause !== null ? cause.message : void 0;
			return String(message ? message : cause);
		}
		//#endregion
		//#region src/session-map/branch.ts
		/**
		* Composer Git branch badge.
		*
		* The browser cannot run `git`, so the branch is read from the repository's
		* metadata through the Host's `workspaceFiles` Remote: `.git/HEAD` names the
		* checked-out branch, a `.git` file points at the real directory of a linked
		* worktree, and a change notification on whichever HEAD was found keeps the
		* badge current when the reader switches branch.
		*
		* A folder without a repository is a normal state, not an error: the badge
		* says so and follows `.git` itself, so initialising a repository later also
		* reaches the display.
		*
		* @module dsh-session-map/session-map/branch
		*/
		/**
		* Parse `.git/HEAD`.
		*
		* Symbolic HEADs name a branch under `refs/heads/`; any other ref is kept whole
		* and marked detached because it is not the branch people mean when they ask
		* for the current branch. A plain commit id is a detached HEAD and is shortened
		* the way `git` shortens it.
		* @param text - the complete HEAD file.
		* @returns the parsed value, or `undefined` when the file is not a HEAD this
		* display understands.
		*/
		function parseHead(text) {
			const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
			const line = first === void 0 ? "" : first.trim();
			if (line.startsWith("ref: ")) {
				const ref = line.slice(5).trim();
				if (ref === "") return void 0;
				if (ref.startsWith("refs/heads/")) {
					const branch = ref.slice(11);
					return branch === "" ? void 0 : {
						branch,
						detached: false
					};
				}
				return {
					branch: ref,
					detached: true
				};
			}
			if (/^[0-9a-f]{7,64}$/i.test(line)) return {
				branch: line.slice(0, 7),
				detached: true
			};
		}
		/**
		* Parse the first line of a `.git` file.
		* @param text - the complete `.git` file of a linked worktree or submodule.
		* @returns the `gitdir:` target, or `undefined` when the file is not one.
		*/
		function parseGitdir(text) {
			const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
			const line = first === void 0 ? "" : first.trim();
			const match = /^gitdir:\s*(.+)$/i.exec(line);
			if (match === null) return void 0;
			const target = match[1]?.trim() ?? "";
			return target === "" ? void 0 : target;
		}
		/**
		* Resolve a `gitdir:` target against the `.git` file that named it.
		*
		* Git writes an absolute path in most linked worktrees and a path relative to
		* the directory holding the `.git` file in submodules; both forms are accepted,
		* with either slash direction.
		* @param baseFile - absolute path of the `.git` file.
		* @param target - the `gitdir:` value.
		* @returns the absolute target path, without a trailing slash.
		*/
		function resolveGitPath(baseFile, target) {
			const normalized = target.replace(/\\/g, "/");
			const drive = /^[A-Za-z]:/.exec(normalized);
			if (normalized.startsWith("/") || normalized.startsWith("//") || drive !== null) return normalizePath(normalized);
			const base = baseFile.replace(/\\/g, "/");
			const slash = base.lastIndexOf("/");
			const directory = slash >= 0 ? base.slice(0, slash) : "";
			return normalizePath(directory === "" ? normalized : directory + "/" + normalized);
		}
		/**
		* Collapse `.` and `..` segments while preserving the path's root form.
		* @param path - an absolute or relative slash path.
		* @returns the collapsed path.
		*/
		function normalizePath(path) {
			const prefix = path.startsWith("//") ? "//" : /^[A-Za-z]:/.exec(path)?.[0] ?? (path.startsWith("/") ? "/" : "");
			const rest = path.slice(prefix.length);
			const parts = [];
			for (const part of rest.split("/")) {
				if (part === "" || part === ".") continue;
				if (part === "..") {
					parts.pop();
					continue;
				}
				parts.push(part);
			}
			const body = parts.join("/");
			if (prefix === "/") return "/" + body;
			if (prefix === "//") return "//" + body;
			if (prefix === "") return body;
			return prefix + "/" + body;
		}
		/**
		* Whether a failed read means the path simply is not there in the form asked
		* for, which is how a linked-worktree `.git` file and a folder without a
		* repository both present themselves.
		* @param error - the Remote failure.
		* @returns true when the caller should try the next path.
		*/
		function isMissing(error) {
			return error.code === "workspace-file/not-found" || error.code === "workspace-file/not-regular-file" || error.code === "workspace-file/not-text";
		}
		/**
		* Resolve the current branch of one Session's workspace.
		*
		* The common case reads `.git/HEAD` directly. A `gitdir:` file (a linked
		* worktree or a submodule checkout) is followed to its HEAD. Everything else is
		* reported as "not a repository"; only a genuine failure becomes an error.
		* @param files - the `workspaceFiles` Remote.
		* @param sessionId - the Session whose filesystem authorizes the read.
		* @param signal - cancellation for unmount or Session change.
		* @returns the branch, the no-repository state, or an error with its message.
		*/
		async function readGitBranch(files, sessionId, signal) {
			try {
				const head = await files.read(sessionId, ".git/HEAD", {}, signal);
				if (head.ok) {
					const parsed = parseHead(head.value.text);
					if (parsed !== void 0) return {
						status: "branch",
						branch: parsed.branch,
						detached: parsed.detached,
						headPath: head.value.absolutePath
					};
					return {
						status: "error",
						message: "无法解析 .git/HEAD",
						watchPath: head.value.absolutePath
					};
				}
				if (!isMissing(head.error)) return failureState(head.error);
				const marker = await files.read(sessionId, ".git", {}, signal);
				if (!marker.ok) {
					if (isMissing(marker.error)) return {
						status: "none",
						watchPath: ".git"
					};
					return failureState(marker.error);
				}
				const gitdir = parseGitdir(marker.value.text);
				if (gitdir === void 0) return {
					status: "none",
					watchPath: ".git"
				};
				const headPath = resolveGitPath(marker.value.absolutePath, gitdir) + "/HEAD";
				const linked = await files.read(sessionId, headPath, {}, signal);
				if (!linked.ok) {
					if (isMissing(linked.error)) return {
						status: "none",
						watchPath: ".git"
					};
					return failureState(linked.error);
				}
				const parsed = parseHead(linked.value.text);
				if (parsed === void 0) return {
					status: "error",
					message: "无法解析 " + headPath,
					watchPath: headPath
				};
				return {
					status: "branch",
					branch: parsed.branch,
					detached: parsed.detached,
					headPath
				};
			} catch (cause) {
				if (signal.aborted) return { status: "loading" };
				return {
					status: "error",
					message: errorText$3(cause)
				};
			}
		}
		/**
		* Turn a Remote failure into display state.
		* @param error - the failure.
		* @returns the error state, with the Host message when it has one.
		*/
		function failureState(error) {
			return {
				status: "error",
				message: error.message ?? error.code ?? "读取 Git 分支失败"
			};
		}
		/**
		* Follow one repository's HEAD and re-resolve on every write.
		* @param runtime - the Remote face.
		* @param sessionId - the Session whose workspace is read.
		* @returns the latest state, starting as loading.
		*/
		function useGitBranch(runtime, sessionId) {
			const [state, setState] = react.useState({ status: "loading" });
			react.useEffect(() => {
				const controller = new AbortController();
				let disposed = false;
				let handle;
				const run = async () => {
					for (;;) {
						const reading = await readGitBranch(runtime.workspaceFiles, sessionId, controller.signal);
						if (disposed || controller.signal.aborted) return;
						setState(reading);
						if (reading.status === "loading") return;
						const watchPath = reading.status === "branch" ? reading.headPath : reading.watchPath;
						if (watchPath === void 0) return;
						let changed = false;
						try {
							handle = runtime.workspaceFiles.changes(sessionId, watchPath, controller.signal);
							for await (const frame of handle) {
								if (disposed || controller.signal.aborted) return;
								if (frame.kind === "change") {
									changed = true;
									break;
								}
							}
						} catch {
							return;
						} finally {
							handle?.dispose?.();
							handle = void 0;
						}
						if (!changed) return;
					}
				};
				run();
				return () => {
					disposed = true;
					controller.abort();
					handle?.dispose?.();
					handle = void 0;
				};
			}, [runtime, sessionId]);
			return state;
		}
		/**
		* Project one state into its visible text and its tooltip.
		* @param state - the current reading.
		* @returns text, title, and the modifier class.
		*/
		function branchBadgeView(state) {
			switch (state.status) {
				case "loading": return {
					text: "Git …",
					title: "正在读取当前 Git 分支",
					className: "dsm-git dsm-git--muted"
				};
				case "branch": return state.detached ? {
					text: state.branch,
					title: "分离 HEAD：" + state.branch,
					className: "dsm-git"
				} : {
					text: state.branch,
					title: "当前 Git 分支：" + state.branch,
					className: "dsm-git"
				};
				case "none": return {
					text: "无 Git 仓库",
					title: "当前会话的工作区不是 Git 仓库",
					className: "dsm-git dsm-git--muted"
				};
				case "error": return {
					text: "Git 读取失败",
					title: "读取当前 Git 分支失败：" + state.message,
					className: "dsm-git dsm-git--error"
				};
			}
		}
		/** The branch glyph, drawn inline so the bundle carries no icon dependency. */
		const BRANCH_GLYPH = react.createElement("svg", {
			className: "dsm-git__glyph",
			width: 13,
			height: 13,
			viewBox: "0 0 16 16",
			"aria-hidden": "true",
			focusable: "false"
		}, react.createElement("path", {
			d: "M5 4.5v7",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.2,
			strokeLinecap: "round"
		}), react.createElement("circle", {
			cx: 5,
			cy: 3,
			r: 1.6,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.2
		}), react.createElement("circle", {
			cx: 5,
			cy: 13,
			r: 1.6,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.2
		}), react.createElement("circle", {
			cx: 11,
			cy: 5.5,
			r: 1.6,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.2
		}), react.createElement("path", {
			d: "M11 7.1c0 2.4-2.2 2.9-4.5 3.4",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.2,
			strokeLinecap: "round"
		}));
		/**
		* Build the badge component for one plugin run.
		* @param runtime - the Remote face captured at apply time.
		* @returns the component to register in `conversation.input.left`.
		*/
		function createGitBranchBadge(runtime) {
			function GitBranchBadge(props) {
				const view = branchBadgeView(useGitBranch(runtime, props.sessionId));
				return react.createElement("span", {
					className: view.className,
					title: view.title,
					"aria-label": view.title
				}, BRANCH_GLYPH, react.createElement("span", { className: "dsm-git__name" }, view.text));
			}
			return GitBranchBadge;
		}
		//#endregion
		//#region src/session-map/css.ts
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
		* @module dsh-session-map/session-map/css
		*/
		/** Every rule the overview and the canvas use, in one sheet. */
		const CSS$3 = `
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
`;
		//#endregion
		//#region src/session-map/constants.ts
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
		* @module dsh-session-map/session-map/constants
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
		const WHEEL_ZOOM_BASE = 1.02;
		/** Largest scale change one wheel event may apply on its own. */
		const WHEEL_ZOOM_MAX_STEP = 1.25;
		/** Stylesheet class per edge kind. */
		const EDGE_CLASS = {
			chain: "dsm__edge dsm__edge--chain",
			fork: "dsm__edge dsm__edge--fork",
			sub: "dsm__edge dsm__edge--sub"
		};
		//#endregion
		//#region src/session-map/flags.ts
		/**
		* Plugin-run flags: state that outlives one mounted View.
		*
		* Both seats (the Conversation tab and the right column's tab) are
		* session-scoped, so switching Session unmounts the View and would re-run a
		* `React.useState` initializer. A flag lives on the plugin run instead, and its
		* subscription keeps two simultaneously mounted instances in step.
		*
		* @module dsh-session-map/session-map/flags
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
		//#region src/git-workspace/client.ts
		/** Browser-local key holding the last parent directory the user chose. */
		const PARENT_DIRECTORY_KEY = "dsh.git-workspace.parentDir";
		/** Route family shared with the Host half. */
		const ROUTE$2 = "/plugin-git-workspace";
		/** Chinese copy for the stable Host failure codes. */
		const FAILURE_COPY = {
			"invalid-url": "仓库地址无效，请检查后重试。",
			"unsupported-url": "地址格式不受支持：请使用 https / ssh / git / file 地址，或 git@host:path 形式。",
			"invalid-directory": "存放目录无效：请选择一个绝对路径目录。",
			"git-not-found": "没有找到 git 可执行文件，请先安装 git。",
			"parent-missing": "存放目录不存在或不可写，请重新选择。",
			"target-exists": "目标目录已存在，请换一个存放目录，或先移走旧目录。",
			authentication: "Git 认证失败：请先在终端配置 SSH key 或 git 凭据；本页面不接收密码。",
			"not-found": "仓库不存在，或当前账号无权访问。",
			network: "无法连接仓库所在的服务器，请检查网络后重试。",
			timeout: "克隆超时，请检查网络，或打开浅克隆后重试。",
			busy: "已有克隆任务正在进行，请稍候再试。",
			"workspace-failed": "仓库已克隆成功，但添加工作区失败。",
			"clone-failed": "克隆失败，请查看下方 git 输出。",
			"invalid-request": "请求内容无效，请刷新页面后重试。",
			"unsupported-media-type": "请求格式不被接受，请刷新页面后重试。",
			"picker-failed": "打开目录选择器失败。",
			forbidden: "这个页面只允许从本机操作；当前连接来自其他机器，已拒绝。",
			internal: "Host 内部错误，请重试；持续失败时可查看 DSH 日志。",
			"bad-response": "Host 返回了无法解析的响应，请刷新页面后重试。"
		};
		/** One read of a browser-local preference. */
		function readStored$1(key) {
			if (typeof localStorage === "undefined") return void 0;
			try {
				const value = localStorage.getItem(key);
				return value === null ? void 0 : value;
			} catch {
				return;
			}
		}
		/** One write of a browser-local preference; denial is not an error. */
		function writeStored$1(key, value) {
			if (typeof localStorage === "undefined") return;
			try {
				localStorage.setItem(key, value);
			} catch {}
		}
		/** Whether an unknown thrown value is the abort of a page-owned request. */
		function isAbortError$2(error) {
			return typeof error === "object" && error !== null && error.name === "AbortError";
		}
		/** Printable text for an unknown thrown value. */
		function errorText$2(error) {
			if (error instanceof Error) return error.message;
			if (typeof error === "string") return error;
			return String(error);
		}
		/**
		* Fetch one Host route on the page's own origin.
		* @param path - route path under this plugin's prefix.
		* @param request - method and optional JSON body.
		* @returns the HTTP status and decoded body.
		*/
		async function requestHost(path, request, signal) {
			const init = {
				method: request.method,
				cache: "no-store"
			};
			if (signal !== void 0) init.signal = signal;
			if (request.method === "POST") {
				init.headers = { "content-type": "application/json" };
				if (request.body !== void 0) init.body = JSON.stringify(request.body);
			}
			const response = await fetch(new URL(path, document.baseURI), init);
			const text = await response.text();
			if (text === "") return {
				status: response.status,
				body: void 0
			};
			try {
				return {
					status: response.status,
					body: JSON.parse(text)
				};
			} catch {
				return {
					status: response.status,
					body: void 0
				};
			}
		}
		/**
		* Build the page runtime over the live client context.
		*
		* Services are read lazily on use: the directory picker belongs to a separate
		* plugin bundle that may compose after this one.
		* @param ctx - browser root context.
		* @returns the runtime the Settings page calls.
		*/
		function createGitWorkspaceRuntime(ctx) {
			const locator = ctx;
			return {
				async pickDirectory() {
					const uiWorkspace = locator.get("uiWorkspace");
					if (uiWorkspace === void 0 || typeof uiWorkspace.pickDirectory !== "function") throw new Error("目录选择服务不可用");
					return await uiWorkspace.pickDirectory();
				},
				async loadState(signal) {
					const response = await requestHost(`${ROUTE$2}/state`, { method: "GET" }, signal);
					const envelope = response.body;
					if (response.status !== 200 || envelope?.ok !== true) throw new Error(`Host 状态读取失败（HTTP ${response.status}）`);
					return {
						gitAvailable: envelope.git?.available === true,
						defaultParentDir: typeof envelope.defaultParentDir === "string" ? envelope.defaultParentDir : null
					};
				},
				async clone(input, signal) {
					const response = await requestHost(`${ROUTE$2}/clone`, {
						method: "POST",
						body: input
					}, signal);
					const envelope = response.body;
					if (envelope?.ok === true) {
						const workspace = envelope.workspace;
						if (workspace === void 0) return {
							ok: false,
							error: {
								code: "bad-response",
								message: "the Host returned no workspace"
							}
						};
						return {
							ok: true,
							workspace: {
								id: workspace.id,
								path: workspace.path,
								title: workspace.title
							}
						};
					}
					const failure = envelope?.error;
					return {
						ok: false,
						error: {
							code: typeof failure?.code === "string" ? failure.code : "clone-failed",
							message: typeof failure?.message === "string" ? failure.message : `HTTP ${response.status}`,
							...typeof failure?.detail === "string" ? { detail: failure.detail } : {}
						}
					};
				}
			};
		}
		/**
		* Build the Settings section body.
		* @param runtime - Host and browser capabilities.
		* @returns a slot component rendering the clone form.
		*/
		function createGitWorkspaceSettings(runtime) {
			return function GitWorkspaceSettings() {
				const [url, setUrl] = react.useState("");
				const [parentDir, setParentDir] = react.useState(() => readStored$1(PARENT_DIRECTORY_KEY) ?? "");
				const [shallow, setShallow] = react.useState(false);
				const [gitAvailable, setGitAvailable] = react.useState(null);
				const [cloning, setCloning] = react.useState(false);
				const [failure, setFailure] = react.useState(null);
				const [added, setAdded] = react.useState(null);
				const inFlight = react.useRef(null);
				react.useEffect(() => {
					const controller = new AbortController();
					let cancelled = false;
					runtime.loadState(controller.signal).then((state) => {
						if (cancelled) return;
						setGitAvailable(state.gitAvailable);
						setParentDir((previous) => previous === "" ? state.defaultParentDir ?? "" : previous);
					}).catch((error) => {
						if (cancelled || isAbortError$2(error)) return;
						setGitAvailable(null);
						setFailure({
							code: "state-unavailable",
							message: `无法连接 Host：${errorText$2(error)}`
						});
					});
					return () => {
						cancelled = true;
						controller.abort();
					};
				}, []);
				react.useEffect(() => () => {
					inFlight.current?.abort();
				}, []);
				const updateParentDir = (next) => {
					setParentDir(next);
					setFailure(null);
					setAdded(null);
					writeStored$1(PARENT_DIRECTORY_KEY, next);
				};
				const chooseDirectory = async () => {
					setFailure(null);
					try {
						const picked = await runtime.pickDirectory();
						if (picked !== null) updateParentDir(picked);
					} catch (error) {
						setFailure({
							code: "picker-failed",
							message: FAILURE_COPY["picker-failed"] ?? errorText$2(error)
						});
					}
				};
				const submit = async (event) => {
					event.preventDefault();
					if (cloning) return;
					const trimmedUrl = url.trim();
					const trimmedParent = parentDir.trim();
					if (trimmedUrl === "") {
						setFailure({
							code: "invalid-url",
							message: "请先填写 Git 仓库地址。"
						});
						return;
					}
					if (trimmedParent === "") {
						setFailure({
							code: "invalid-directory",
							message: "请先选择存放目录。"
						});
						return;
					}
					setCloning(true);
					setFailure(null);
					setAdded(null);
					const controller = new AbortController();
					inFlight.current = controller;
					try {
						const result = await runtime.clone({
							url: trimmedUrl,
							parentDir: trimmedParent,
							shallow
						}, controller.signal);
						if (result.ok) {
							setAdded({
								title: result.workspace.title,
								path: result.workspace.path
							});
							writeStored$1(PARENT_DIRECTORY_KEY, trimmedParent);
						} else setFailure({
							code: result.error.code,
							message: FAILURE_COPY[result.error.code] ?? `克隆失败：${result.error.message}`,
							...result.error.detail === void 0 ? {} : { detail: result.error.detail }
						});
					} catch (error) {
						if (!isAbortError$2(error)) setFailure({
							code: "network",
							message: `请求 Host 失败：${errorText$2(error)}`
						});
					} finally {
						inFlight.current = null;
						setCloning(false);
					}
				};
				const toggleShallow = () => {
					setShallow((previous) => !previous);
				};
				return react.createElement("div", { className: "gw-page" }, react.createElement("style", null, CSS$2), react.createElement("div", { className: "gw-inner" }, react.createElement("header", { className: "gw-head" }, react.createElement("h1", { className: "gw-title" }, "从 Git 克隆工作区"), react.createElement("p", { className: "gw-desc" }, "填写仓库地址并选择存放目录。克隆完成后，这个目录会自动添加为 DSH 工作区。")), gitAvailable === false ? react.createElement("div", {
					className: "gw-status gw-status--warn",
					role: "status"
				}, react.createElement("div", { className: "gw-statusTitle" }, "没有检测到 git"), react.createElement("div", null, "请先安装 git 后可再回来克隆；本机已安装却仍看到这条提示时，刷新页面重试。")) : null, react.createElement("form", {
					className: "gw-form",
					onSubmit: submit,
					"aria-busy": cloning
				}, react.createElement("div", { className: "gw-field" }, react.createElement("label", {
					className: "gw-label",
					htmlFor: "gw-url"
				}, "仓库地址"), react.createElement("input", {
					id: "gw-url",
					className: "gw-input",
					type: "text",
					inputMode: "url",
					autoComplete: "off",
					spellCheck: false,
					placeholder: "https://github.com/owner/repo.git",
					value: url,
					disabled: cloning,
					onChange: (event) => {
						setUrl(event.currentTarget.value);
						setFailure(null);
						setAdded(null);
					}
				}), react.createElement("p", { className: "gw-hint" }, "支持 https、ssh、git、file 地址，或 git@host:path 形式。私有仓库请先在终端配置好凭据。")), react.createElement("div", { className: "gw-field" }, react.createElement("label", {
					className: "gw-label",
					htmlFor: "gw-parent"
				}, "存放目录"), react.createElement("div", { className: "gw-dirRow" }, react.createElement("input", {
					id: "gw-parent",
					className: "gw-input",
					type: "text",
					autoComplete: "off",
					spellCheck: false,
					placeholder: "例如 /Users/you/Developer/projects",
					value: parentDir,
					disabled: cloning,
					onChange: (event) => updateParentDir(event.currentTarget.value)
				}), react.createElement("button", {
					type: "button",
					className: "gw-btn",
					onClick: chooseDirectory,
					disabled: cloning
				}, "选择…")), react.createElement("p", { className: "gw-hint" }, "仓库会克隆到这个目录下新建的同名子目录；这里会记住你上次选择的目录。")), react.createElement("div", { className: "gw-switchRow" }, react.createElement("button", {
					type: "button",
					role: "switch",
					"aria-checked": shallow,
					"aria-label": "浅克隆",
					className: "gw-switch",
					onClick: toggleShallow,
					disabled: cloning
				}, react.createElement("span", { className: "gw-switchThumb" })), react.createElement("div", { className: "gw-switchText" }, react.createElement("div", { className: "gw-switchTitle" }, "浅克隆（--depth 1）"), react.createElement("div", { className: "gw-hint" }, "默认关闭，克隆完整提交历史；打开后只拉取最近一次提交，更快、更省空间。"))), react.createElement("div", { className: "gw-actions" }, react.createElement("button", {
					type: "submit",
					className: "gw-btn gw-btn--primary",
					disabled: cloning || gitAvailable === false
				}, cloning ? "克隆中…" : "克隆"), cloning ? react.createElement("span", {
					className: "gw-hint",
					role: "status"
				}, "正在克隆并添加工作区，仓库较大时请稍候…") : null)), added === null ? null : react.createElement("div", {
					className: "gw-status gw-status--ok",
					role: "status"
				}, react.createElement("div", { className: "gw-statusTitle" }, `已添加工作区「${added.title}」`), react.createElement("div", { className: "gw-statusPath" }, added.path)), failure === null ? null : react.createElement("div", {
					className: "gw-status gw-status--error",
					role: "alert"
				}, react.createElement("div", { className: "gw-statusTitle" }, failure.message), failure.detail === void 0 || failure.detail === "" ? null : react.createElement("pre", { className: "gw-detail" }, failure.detail))));
			};
		}
		/** Component-local stylesheet; every color is a Harness theme token. */
		const CSS$2 = `
.gw-page { box-sizing: border-box; padding: 2px 0 28px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: inherit; }
.gw-page * { box-sizing: border-box; }
.gw-inner { display: flex; flex-direction: column; gap: 14px; max-width: 560px; }
.gw-head { display: flex; flex-direction: column; gap: 4px; }
.gw-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.gw-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.gw-form { display: flex; flex-direction: column; }
.gw-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.gw-field + .gw-field { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.gw-label { font-size: 13px; font-weight: 500; }
.gw-input { width: 100%; min-width: 0; height: 34px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.5; }
.gw-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.7; }
.gw-input:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.gw-input:disabled { opacity: 0.6; cursor: default; }
.gw-dirRow { display: flex; align-items: center; gap: 8px; }
.gw-btn { flex: none; height: 34px; padding: 0 14px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.gw-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.gw-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.gw-btn:disabled { cursor: not-allowed; opacity: 0.45; }
.gw-btn--primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; font-weight: 500; }
.gw-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.06); }
.gw-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.gw-switchRow { display: flex; align-items: flex-start; gap: 10px; padding: 14px 0 2px; }
.gw-switch { position: relative; flex: none; width: 36px; height: 20px; margin-top: 1px; padding: 2px; border: 0; border-radius: 999px; background: var(--dsw-alias-border-l2); cursor: pointer; }
.gw-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.gw-switch:disabled { cursor: default; opacity: 0.5; }
.gw-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.gw-switchThumb { display: block; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 120ms ease; }
.gw-switch[aria-checked='true'] .gw-switchThumb { transform: translateX(16px); }
.gw-switchText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gw-switchTitle { font-size: 13px; font-weight: 500; }
.gw-actions { display: flex; align-items: center; gap: 10px; padding-top: 14px; }
.gw-status { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
.gw-statusTitle { font-weight: 500; }
.gw-statusPath { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.gw-status--ok { border-color: var(--dsw-alias-state-success-primary); }
.gw-status--ok .gw-statusTitle { color: var(--dsw-alias-state-success-primary); }
.gw-status--warn { border-color: var(--dsw-alias-state-warn-primary); }
.gw-status--warn .gw-statusTitle { color: var(--dsw-alias-state-warn-primary); }
.gw-status--error { border-color: var(--dsw-alias-state-error-primary); }
.gw-status--error .gw-statusTitle { color: var(--dsw-alias-state-error-primary); }
.gw-detail { margin: 2px 0 0; max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
`;
		//#endregion
		//#region src/git-workspace/git-parse.ts
		/**
		* Parse one unified diff into hunks.
		* @param text - `show`/`diff` patch output.
		* @param path - repository-relative path the patch describes.
		* @param truncated - whether the Host cut the output.
		* @returns the displayable diff.
		*/
		function parseUnifiedDiff(text, path, truncated = false) {
			const binary = /^Binary files .* differ$/m.test(text) || /^GIT binary patch$/m.test(text);
			const hunks = [];
			let current;
			let oldLine = 0;
			let newLine = 0;
			const flush = () => {
				if (current === void 0) return;
				hunks.push(current);
				current = void 0;
			};
			for (const line of text.split("\n")) {
				const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
				if (header !== null) {
					flush();
					const oldStart = Number(header[1]);
					const oldLines = header[2] === void 0 ? 1 : Number(header[2]);
					const newStart = Number(header[3]);
					const newLines = header[4] === void 0 ? 1 : Number(header[4]);
					oldLine = oldStart;
					newLine = newStart;
					current = {
						oldStart,
						oldLines,
						newStart,
						newLines,
						lines: []
					};
					continue;
				}
				if (current === void 0) continue;
				if (line.startsWith("diff --git ")) break;
				if (line.startsWith("\\ No newline")) continue;
				if (line.startsWith("+")) {
					current.lines.push({
						kind: "+",
						text: line.slice(1),
						oldLine: null,
						newLine
					});
					newLine += 1;
					continue;
				}
				if (line.startsWith("-")) {
					current.lines.push({
						kind: "-",
						text: line.slice(1),
						oldLine,
						newLine: null
					});
					oldLine += 1;
					continue;
				}
				if (line.startsWith(" ")) {
					current.lines.push({
						kind: " ",
						text: line.slice(1),
						oldLine,
						newLine
					});
					oldLine += 1;
					newLine += 1;
					continue;
				}
			}
			flush();
			return {
				path,
				binary,
				truncated,
				hunks
			};
		}
		//#endregion
		//#region src/git-workspace/window/lanes.ts
		/**
		* Assign one lane per commit.
		*
		* The input is expected in git order (children before parents). Each row keeps
		* the active lane vector so the renderer can draw continuous vertical lines.
		* @param commits - one page of commits.
		* @returns one graph row per commit.
		*/
		function computeGraph(commits) {
			const lanes = [];
			const rows = [];
			for (const commit of commits) {
				const before = lanes.slice();
				let lane = lanes.indexOf(commit.oid);
				if (lane < 0) {
					lanes.push(commit.oid);
					lane = lanes.length - 1;
				}
				const firstParent = commit.parents[0];
				if (firstParent !== void 0) lanes[lane] = firstParent;
				else lanes.splice(lane, 1);
				let merged = false;
				for (const parent of commit.parents.slice(1)) {
					merged = true;
					if (!lanes.includes(parent)) lanes.splice(lane + 1, 0, parent);
				}
				rows.push({
					oid: commit.oid,
					lane: Math.max(0, lane),
					before,
					after: lanes.slice(),
					merged
				});
			}
			return rows;
		}
		//#endregion
		//#region src/git-workspace/window/icons.ts
		/**
		* Inline SVG icons for the Git tool window.
		*
		* The browser half cannot import the product's icon set, so the handful of
		* glyphs the panel needs live here as plain elements using `currentColor`.
		*
		* @module dsh-session-map/git-workspace/window/icons
		*/
		/** Build one 16×16 stroke icon. */
		function icon(path, props, filled = false) {
			const size = props.size ?? 16;
			return react.createElement("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				focusable: "false"
			}, react.createElement("path", {
				d: path,
				fill: filled ? "currentColor" : "none",
				stroke: filled ? "none" : "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}
		/** Sidebar entry icon; receives the owner's selected state. */
		function GitPanelIcon(props) {
			return react.createElement("span", { className: props.active ? "dgw-panelIcon dgw-panelIcon--active" : "dgw-panelIcon" }, icon("M4 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM12 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 6.5v3M12 5h-4.5A3.5 3.5 0 0 0 4 8.5v1", { size: props.size }));
		}
		/** Local branch. */
		function BranchIcon(props) {
			return icon("M4 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM12 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 6.5v3M12 5h-4.5A3.5 3.5 0 0 0 4 8.5v1", props);
		}
		/** Remote-tracking branch. */
		function RemoteIcon(props) {
			return icon("M3 8a5 5 0 0 1 5-5M13 8a5 5 0 0 1-5 5M6 8h4M8 6v4", props);
		}
		/** Tag. */
		function TagIcon(props) {
			return icon("M3 3h5l5 5-5 5-5-5V3ZM5.5 5.5h.01", props);
		}
		/** Commit node. */
		function CommitIcon(props) {
			return icon("M8 2v12M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", props);
		}
		/** Generic file. */
		function FileIcon(props) {
			return icon("M4 2h5l3 3v9H4V2ZM9 2v3h3", props);
		}
		/** Folder. */
		function FolderIcon(props) {
			return icon("M2 4h4l1.5 2H14v7H2V4Z", props);
		}
		/** Refresh. */
		function RefreshIcon(props) {
			return icon("M13 8a5 5 0 1 1-1.5-3.5M13 3v3.5H9.5", props);
		}
		/** Fetch. */
		function FetchIcon(props) {
			return icon("M8 2v8M5 7l3 3 3-3M3 13h10", props);
		}
		/** Push. */
		function PushIcon(props) {
			return icon("M8 13V5M5 8l3-3 3 3M3 2h10", props);
		}
		/** Chevron; rotate with CSS. */
		function ChevronIcon(props) {
			return icon("M6 4l4 4-4 4", props);
		}
		/** Search. */
		function SearchIcon(props) {
			return icon("M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM10.5 10.5 14 14", props);
		}
		/** Copy. */
		function CopyIcon(props) {
			return icon("M6 6h7v7H6V6ZM3 10V3h7", props);
		}
		/** Close. */
		function CloseIcon(props) {
			return icon("M4 4l8 8M12 4l-8 8", props);
		}
		/** Panel toggle (rectangle with a divider); used for the commit panel. */
		function PanelLeftIcon(props) {
			return icon("M2 3h12v10H2zM6 3v10", props);
		}
		/** Side-by-side diff presentation. */
		function SideBySideIcon(props) {
			return icon("M2 3h5v10H2zM9 3h5v10H9z", props);
		}
		/** Unified diff presentation. */
		function UnifiedIcon(props) {
			return icon("M2 3h12M2 6h12M2 9h12M2 12h8", props);
		}
		//#endregion
		//#region src/git-workspace/window/diff-view.ts
		/**
		* Diff rendering shared by the two Git carriers: the main tool-window panel and
		* the right-column page.
		*
		* `pairDiffRows` is pure (it turns hunks into side-by-side rows), so the pairing
		* rule has a unit test without a browser. The unified branch keeps the markup
		* the main panel has shipped with; the side-by-side branch is new and only the
		* right-column page turns it on.
		*
		* @module dsh-session-map/git-workspace/window/diff-view
		*/
		/** Count the added and removed lines of a parsed diff. */
		function diffStats(diff) {
			if (diff === null) return {
				adds: 0,
				dels: 0
			};
			let adds = 0;
			let dels = 0;
			for (const hunk of diff.hunks) for (const line of hunk.lines) if (line.kind === "+") adds += 1;
			else if (line.kind === "-") dels += 1;
			return {
				adds,
				dels
			};
		}
		/** Render one hunk caption. */
		function hunkCaption(hunk) {
			return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
		}
		/**
		* Turn hunks into side-by-side rows: a run of `-` lines pairs with the `+` run
		* that follows it, a `+` without a matching `-` sits on the right only, and a
		* context line sits on both sides.
		* @param hunks - parsed diff hunks.
		* @returns the aligned rows, hunk captions included.
		*/
		function pairDiffRows(hunks) {
			const rows = [];
			for (const hunk of hunks) {
				rows.push({
					kind: "hunk",
					text: hunkCaption(hunk)
				});
				let index = 0;
				while (index < hunk.lines.length) {
					const line = hunk.lines[index];
					if (line === void 0) break;
					if (line.kind === " ") {
						rows.push({
							kind: "pair",
							left: line,
							right: line
						});
						index += 1;
						continue;
					}
					if (line.kind === "+") {
						rows.push({
							kind: "pair",
							left: null,
							right: line
						});
						index += 1;
						continue;
					}
					const deletions = [];
					while (index < hunk.lines.length && hunk.lines[index]?.kind === "-") {
						const candidate = hunk.lines[index];
						if (candidate !== void 0) deletions.push(candidate);
						index += 1;
					}
					const additions = [];
					while (index < hunk.lines.length && hunk.lines[index]?.kind === "+") {
						const candidate = hunk.lines[index];
						if (candidate !== void 0) additions.push(candidate);
						index += 1;
					}
					const pairs = Math.max(deletions.length, additions.length);
					for (let pair = 0; pair < pairs; pair += 1) rows.push({
						kind: "pair",
						left: deletions[pair] ?? null,
						right: additions[pair] ?? null
					});
				}
			}
			return rows;
		}
		/** One line's two gutters plus its text, in the unified presentation. */
		function unifiedLine(line, key) {
			return react.createElement("div", {
				className: line.kind === "+" ? "dgw-diffLine dgw-diffLine--add" : line.kind === "-" ? "dgw-diffLine dgw-diffLine--del" : "dgw-diffLine",
				key
			}, react.createElement("span", { className: "dgw-diffLineNo" }, line.oldLine === null ? "" : String(line.oldLine)), react.createElement("span", { className: "dgw-diffLineNo" }, line.newLine === null ? "" : String(line.newLine)), react.createElement("span", { className: "dgw-diffSign" }, line.kind === " " ? " " : line.kind), react.createElement("span", null, line.text));
		}
		/** One code line inside a side pane; the line number lives in the centre gutter. */
		function sideLine(line, key) {
			const tone = line === null ? "" : line.kind === "+" ? " dgw-diffSideRow--add" : line.kind === "-" ? " dgw-diffSideRow--del" : "";
			return react.createElement("div", {
				className: `dgw-diffSideRow${tone}`,
				key
			}, react.createElement("span", { className: "dgw-diffSideText" }, line === null ? "" : line.text));
		}
		/** One row of the fixed centre gutter: old number on the left, new on the right. */
		function gutterLine(left, right, key) {
			const leftTone = left !== null && left.kind === "-" ? " dgw-diffGutterNo--del" : "";
			const rightTone = right !== null && right.kind === "+" ? " dgw-diffGutterNo--add" : "";
			return react.createElement("div", {
				className: "dgw-diffGutterRow",
				key
			}, react.createElement("span", { className: `dgw-diffGutterNo${leftTone}` }, left === null || left.oldLine === null ? "" : String(left.oldLine)), react.createElement("span", { className: `dgw-diffGutterNo${rightTone}` }, right === null || right.newLine === null ? "" : String(right.newLine)));
		}
		/**
		* Side-by-side presentation as two horizontal scroll panes plus a fixed centre
		* gutter. The line numbers never move horizontally: only the code panes scroll,
		* their horizontal positions are linked, and all three columns mirror vertical
		* scrolling so rows stay aligned.
		*/
		function SideDiff(props) {
			const rootRef = react.useRef(null);
			const leftRef = react.useRef(null);
			const rightRef = react.useRef(null);
			const gutterTrackRef = react.useRef(null);
			const syncing = react.useRef(false);
			react.useEffect(() => {
				const root = rootRef.current;
				if (root === null) return void 0;
				const onWheel = (event) => {
					if (event.ctrlKey) return;
					const target = event.target instanceof Element ? event.target.closest(".dgw-diffSidePane") : null;
					const pane = target instanceof HTMLElement ? target : leftRef.current;
					if (pane === null) return;
					event.preventDefault();
					const horizontal = event.shiftKey && event.deltaX === 0;
					pane.scrollTop += horizontal ? 0 : event.deltaY * 1.8;
					pane.scrollLeft += (horizontal ? event.deltaY : event.deltaX) * 1.8;
				};
				root.addEventListener("wheel", onWheel, { passive: false });
				return () => root.removeEventListener("wheel", onWheel);
			}, []);
			const syncScroll = (event) => {
				if (syncing.current) return;
				const source = event.currentTarget;
				syncing.current = true;
				const other = source === leftRef.current ? rightRef.current : leftRef.current;
				if (other !== null) {
					other.scrollTop = source.scrollTop;
					const sourceMax = source.scrollWidth - source.clientWidth;
					const targetMax = other.scrollWidth - other.clientWidth;
					other.scrollLeft = sourceMax <= 0 ? 0 : Math.round(source.scrollLeft / sourceMax * Math.max(0, targetMax));
				}
				if (gutterTrackRef.current !== null) gutterTrackRef.current.style.transform = `translateY(${-source.scrollTop}px)`;
				requestAnimationFrame(() => {
					syncing.current = false;
				});
			};
			const rows = pairDiffRows(props.hunks);
			const left = rows.map((row, index) => row.kind === "hunk" ? react.createElement("div", {
				className: "dgw-diffSideHunk",
				key: `h${index}`
			}, row.text) : sideLine(row.left, `l${index}`));
			const gutter = rows.map((row, index) => row.kind === "hunk" ? react.createElement("div", {
				className: "dgw-diffGutterHunk",
				key: `h${index}`
			}) : gutterLine(row.left, row.right, `g${index}`));
			const right = rows.map((row, index) => row.kind === "hunk" ? react.createElement("div", {
				className: "dgw-diffSideHunk dgw-diffSideHunk--blank",
				key: `h${index}`
			}) : sideLine(row.right, `r${index}`));
			return react.createElement("div", {
				className: "dgw-diff dgw-diffSide",
				ref: rootRef,
				title: "并排视图：行号固定在中间，左右代码栏横向滚动联动，竖向滚动保持对齐（Shift + 滚轮或触控板）"
			}, react.createElement("div", {
				className: "dgw-diffSidePane",
				ref: leftRef,
				onScroll: syncScroll
			}, ...left), react.createElement("div", { className: "dgw-diffSideGutter" }, react.createElement("div", {
				className: "dgw-diffGutterTrack",
				ref: gutterTrackRef
			}, ...gutter)), react.createElement("div", {
				className: "dgw-diffSidePane",
				ref: rightRef,
				onScroll: syncScroll
			}, ...right));
		}
		/** Render one diff in the requested presentation. */
		function DiffView(props) {
			if (props.file === null) return react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, "选择一个文件查看差异"));
			if (props.loading) return react.createElement("div", { className: "dgw-loading" }, "正在读取差异…");
			if (props.diff === null) return react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, props.hint ?? "没有可显示的差异"));
			if (props.diff.binary) return react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, "二进制文件，无法预览差异"));
			if (props.diff.hunks.length === 0) return react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, props.hint ?? "没有可显示的差异"));
			if (props.mode === "side") return react.createElement(SideDiff, { hunks: props.diff.hunks });
			return react.createElement("div", { className: "dgw-diff" }, ...props.diff.truncated ? [react.createElement("div", {
				className: "dgw-hunkHead",
				key: "truncated"
			}, "差异过大，已截断")] : [], ...props.diff.hunks.flatMap((hunk, hunkIndex) => [react.createElement("div", {
				className: "dgw-hunkHead",
				key: `h${hunkIndex}`
			}, hunkCaption(hunk)), ...hunk.lines.map((line, lineIndex) => unifiedLine(line, `${hunkIndex}-${lineIndex}`))]));
		}
		//#endregion
		//#region src/git-workspace/window/log.ts
		/**
		* Presentational panes for the log tab: the branch tree, the commit list with
		* client-side graph lanes, and the commit-detail/diff column.
		*
		* These components own only local view state (search text, section collapse);
		* every fetch, selection and refresh decision lives in the shell so an SSR test
		* can render each pane from plain props.
		*
		* @module dsh-session-map/git-workspace/window/log
		*/
		/** Format one ISO timestamp the way the tool window shows it. */
		function formatWhen(value) {
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return value;
			const now = /* @__PURE__ */ new Date();
			const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
			const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
			if (sameDay) return `今天 ${time}`;
			const day = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
			if (date.getFullYear() === now.getFullYear()) return `${day} ${time}`;
			return `${date.getFullYear()}/${day} ${time}`;
		}
		/** One display label for a commit's refs, merging `origin/x` with local `x`. */
		function refLabels(row) {
			const labels = [];
			for (const tag of row.refs.tags) labels.push({
				text: tag,
				tag: true
			});
			const remote = new Set(row.refs.remoteBranches);
			for (const branch of row.refs.branches) {
				const match = [...remote].find((candidate) => candidate === branch || candidate.endsWith(`/${branch}`));
				if (match !== void 0) {
					labels.push({
						text: `${match.split("/")[0]} & ${branch}`,
						tag: false
					});
					remote.delete(match);
				} else labels.push({
					text: branch,
					tag: false
				});
			}
			for (const branch of remote) labels.push({
				text: branch,
				tag: false
			});
			return labels;
		}
		/** Event used to keep at most one context menu open across the tree and list. */
		const MENU_EXCLUSIVE_EVENT = "dsh-git-window:menu-open";
		/** Ask any other git list to close its context menu before this one opens. */
		function announceMenuOpen() {
			if (typeof window !== "undefined") window.dispatchEvent(new Event(MENU_EXCLUSIVE_EVENT));
		}
		/** One vertical guide per branch-tree nesting level. */
		function treeGuides(depth, prefix) {
			return Array.from({ length: depth }, (_, index) => react.createElement("span", {
				className: "dgw-treeGuide",
				key: `${prefix}-g${index}`
			}));
		}
		/** Render one branch row. */
		function branchRow(branch, active, depth, onSelect, onCheckout, onMenu) {
			const badge = branch.track === null ? null : branch.track.gone ? "gone" : [branch.track.ahead > 0 ? `↑${branch.track.ahead}` : "", branch.track.behind > 0 ? `↓${branch.track.behind}` : ""].filter(Boolean).join(" ");
			const icon = branch.type === "remote" ? react.createElement(RemoteIcon, { size: 14 }) : branch.type === "tag" ? react.createElement(TagIcon, { size: 14 }) : react.createElement(BranchIcon, { size: 14 });
			return react.createElement("div", {
				key: branch.ref,
				className: [
					"dgw-treeRow",
					branch.isHead ? "dgw-treeRow--current" : "",
					active ? "dgw-treeRow--active" : ""
				].filter(Boolean).join(" "),
				style: { paddingLeft: 38 },
				onClick: onSelect,
				onDoubleClick: branch.type === "local" ? onCheckout : void 0,
				onContextMenu: branch.type === "remote" ? void 0 : onMenu,
				title: branch.name
			}, ...treeGuides(depth, branch.ref), icon, react.createElement("span", { className: "dgw-treeName" }, branch.name.split("/").at(-1) ?? branch.name), badge === null || badge === "" ? null : react.createElement("span", { className: "dgw-treeBadge" }, badge));
		}
		/**
		* Fold slash-separated branch names into a tree.
		* @param branches - branches of one namespace.
		* @returns the sorted forest.
		*/
		function buildBranchTree(branches) {
			const roots = [];
			for (const branch of branches) {
				const parts = branch.name.split("/");
				let level = roots;
				let path = "";
				for (let index = 0; index < parts.length; index += 1) {
					const segment = parts[index];
					path = path === "" ? segment : `${path}/${segment}`;
					let node = level.find((candidate) => candidate.segment === segment);
					if (node === void 0) {
						node = {
							segment,
							path,
							children: []
						};
						level.push(node);
					}
					if (index === parts.length - 1) node.branch = branch;
					level = node.children;
				}
			}
			const sort = (nodes) => {
				nodes.sort((left, right) => left.segment.localeCompare(right.segment));
				for (const node of nodes) sort(node.children);
			};
			sort(roots);
			return roots;
		}
		/** Count leaves under one folded node. */
		function leafCount(node) {
			if (node.branch !== void 0 && node.children.length === 0) return 1;
			return node.children.reduce((total, child) => total + leafCount(child), 0);
		}
		/** Every folder path in one forest, for expand/collapse-all. */
		function folderPathsOf(nodes) {
			const paths = [];
			const walk = (list) => {
				for (const node of list) {
					if (node.children.length > 0) paths.push(node.path);
					walk(node.children);
				}
			};
			walk(nodes);
			return paths;
		}
		/** Render the branch panel. */
		function BranchTree(props) {
			const [filter, setFilter] = react.useState("");
			const [localOpen, setLocalOpen] = react.useState(true);
			const [remoteOpen, setRemoteOpen] = react.useState(true);
			const [tagsOpen, setTagsOpen] = react.useState(true);
			const [collapsedFolders, setCollapsedFolders] = react.useState(/* @__PURE__ */ new Set());
			const [menu, setMenu] = react.useState(null);
			const needle = filter.trim().toLowerCase();
			const matches = (branch) => needle === "" || branch.name.toLowerCase().includes(needle);
			const locals = props.branches.filter((branch) => branch.type === "local" && matches(branch));
			const remotes = props.branches.filter((branch) => branch.type === "remote" && matches(branch));
			const tags = props.branches.filter((branch) => branch.type === "tag" && matches(branch));
			const current = props.head.branch;
			const localTree = buildBranchTree(locals);
			const remoteTree = buildBranchTree(remotes);
			const folderPaths = [...folderPathsOf(localTree), ...folderPathsOf(remoteTree)];
			const expandAllFolders = () => setCollapsedFolders(/* @__PURE__ */ new Set());
			const collapseAllFolders = () => setCollapsedFolders(new Set(folderPaths));
			react.useEffect(() => {
				if (menu === null) return void 0;
				const close = () => setMenu(null);
				const onKey = (event) => {
					if (event.key === "Escape") close();
				};
				const onOtherMenu = () => close();
				window.addEventListener("click", close);
				window.addEventListener("keydown", onKey);
				window.addEventListener("scroll", close, true);
				window.addEventListener(MENU_EXCLUSIVE_EVENT, onOtherMenu);
				return () => {
					window.removeEventListener("click", close);
					window.removeEventListener("keydown", onKey);
					window.removeEventListener("scroll", close, true);
					window.removeEventListener(MENU_EXCLUSIVE_EVENT, onOtherMenu);
				};
			}, [menu]);
			const openMenu = (event, entry) => {
				event.preventDefault();
				event.stopPropagation();
				if (entry.branch !== void 0) props.onSelect(entry.branch.name);
				else if (entry.tag !== void 0) props.onSelect(entry.tag.name);
				announceMenuOpen();
				setMenu({
					x: event.clientX,
					y: event.clientY,
					...entry
				});
			};
			const toggleFolder = (path) => {
				setCollapsedFolders((previous) => {
					const next = new Set(previous);
					if (next.has(path)) next.delete(path);
					else next.add(path);
					return next;
				});
			};
			const menuItem = (label, action) => react.createElement("button", {
				className: "dgw-menuItem",
				type: "button",
				key: label,
				onClick: (event) => {
					event.stopPropagation();
					setMenu(null);
					action();
				}
			}, label);
			const renderNodes = (nodes, depth) => nodes.flatMap((node) => {
				const rows = [];
				const paddingLeft = 20;
				if (node.branch !== void 0 && node.children.length === 0) {
					const branch = node.branch;
					rows.push(branchRow(branch, props.selectedRef === branch.name, depth, () => props.onSelect(branch.name), () => props.onCheckout(branch.name), (event) => openMenu(event, { branch })));
					return rows;
				}
				if (node.branch !== void 0) {
					const branch = node.branch;
					rows.push(branchRow(branch, props.selectedRef === branch.name, depth, () => props.onSelect(branch.name), () => props.onCheckout(branch.name), (event) => openMenu(event, { branch })));
				}
				const open = needle !== "" || !collapsedFolders.has(node.path);
				rows.push(react.createElement("button", {
					key: `folder:${node.path}`,
					className: "dgw-treeRow dgw-treeRow--folder",
					style: { paddingLeft },
					type: "button",
					"data-open": open,
					onClick: () => toggleFolder(node.path)
				}, ...treeGuides(depth, node.path), react.createElement(ChevronIcon, { size: 12 }), react.createElement(FolderIcon, { size: 14 }), react.createElement("span", { className: "dgw-treeName" }, node.segment), react.createElement("span", { className: "dgw-treeBadge" }, String(leafCount(node)))));
				if (open) rows.push(...renderNodes(node.children, depth + 1));
				return rows;
			});
			return react.createElement("div", { className: "dgw-tree" }, react.createElement("div", { className: "dgw-treeHead" }, react.createElement("span", { className: "dgw-search" }, react.createElement(SearchIcon, { size: 13 }), react.createElement("input", {
				className: "dgw-searchInput",
				type: "search",
				placeholder: "分支或标签",
				value: filter,
				onChange: (event) => setFilter(event.target.value),
				"aria-label": "过滤分支"
			})), react.createElement("button", {
				className: "dgw-iconBtn",
				type: "button",
				title: "新建分支",
				"aria-label": "新建分支",
				onClick: () => props.onCreateBranch(current ?? void 0)
			}, "+")), react.createElement("div", { className: "dgw-treeScroll" }, folderPaths.length === 0 ? null : react.createElement("div", { className: "dgw-treeActions" }, react.createElement("button", {
				className: "dgw-linkBtn",
				type: "button",
				onClick: expandAllFolders
			}, "全部展开"), react.createElement("button", {
				className: "dgw-linkBtn",
				type: "button",
				onClick: collapseAllFolders
			}, "全部收起")), react.createElement("div", { className: "dgw-treeSectionHead" }, "HEAD(当前分支)"), current === null ? react.createElement("div", {
				className: `dgw-treeRow${props.head.detached ? "" : " dgw-treeRow--current"}`,
				style: { paddingLeft: 38 }
			}, react.createElement(CommitIcon, { size: 14 }), react.createElement("span", { className: "dgw-treeName" }, props.head.detached ? "HEAD 已分离" : "HEAD")) : react.createElement("div", {
				className: `dgw-treeRow dgw-treeRow--current${props.selectedRef === null ? " dgw-treeRow--active" : ""}`,
				style: { paddingLeft: 38 },
				onClick: () => props.onSelect(null),
				title: current
			}, react.createElement(BranchIcon, { size: 14 }), react.createElement("span", { className: "dgw-treeName" }, current), react.createElement("span", { className: "dgw-treeBadge" }, "HEAD")), react.createElement("button", {
				className: "dgw-treeSectionHead",
				"data-open": localOpen,
				onClick: () => setLocalOpen((open) => !open),
				type: "button"
			}, react.createElement(ChevronIcon, { size: 12 }), `本地 (${locals.length})`), localOpen ? renderNodes(localTree, 0) : null, react.createElement("button", {
				className: "dgw-treeSectionHead",
				"data-open": remoteOpen,
				onClick: () => setRemoteOpen((open) => !open),
				type: "button"
			}, react.createElement(ChevronIcon, { size: 12 }), `远程 (${remotes.length})`), remoteOpen ? renderNodes(remoteTree, 0) : null, tags.length === 0 ? null : react.createElement("button", {
				className: "dgw-treeSectionHead",
				"data-open": tagsOpen,
				onClick: () => setTagsOpen((open) => !open),
				type: "button"
			}, react.createElement(ChevronIcon, { size: 12 }), `标签 (${tags.length})`), tags.length === 0 || !tagsOpen ? null : tags.map((tag) => branchRow(tag, props.selectedRef === tag.name, 0, () => props.onSelect(tag.name), () => void 0, (event) => openMenu(event, { tag })))), menu === null ? null : react.createElement("div", {
				className: "dgw-menu",
				style: {
					left: Math.max(8, Math.min(menu.x, typeof window === "undefined" ? menu.x : window.innerWidth - 200)),
					top: Math.max(8, Math.min(menu.y, typeof window === "undefined" ? menu.y : window.innerHeight - 240))
				}
			}, ...menu.branch === void 0 ? [menuItem("在日志中查看", () => props.onSelect(menu.tag?.name ?? null)), menuItem("删除标签…", () => {
				if (menu.tag !== void 0) props.onDeleteTag(menu.tag.name);
			})] : [
				menuItem("检出", () => {
					if (menu.branch !== void 0) props.onCheckout(menu.branch.name);
				}),
				menuItem("从此分支新建…", () => {
					if (menu.branch !== void 0) props.onCreateBranch(menu.branch.name);
				}),
				menuItem("合并到当前分支", () => {
					if (menu.branch !== void 0) props.onMergeBranch(menu.branch.name);
				}),
				menuItem("将当前分支变基到此处", () => {
					if (menu.branch !== void 0) props.onRebaseBranch(menu.branch.name);
				}),
				menuItem("重命名…", () => {
					if (menu.branch !== void 0) props.onRenameBranch(menu.branch.name);
				}),
				menuItem("删除…", () => {
					if (menu.branch !== void 0) props.onDeleteBranch(menu.branch.name);
				}),
				...menu.branch?.isHead === true ? [menuItem("强制推送（--force-with-lease）…", () => {
					if (menu.branch !== void 0) props.onForcePush(menu.branch.name);
				})] : []
			]));
		}
		/** Lane palette; the gutter is an SVG so colour comes from here, not CSS. */
		const LANE_PALETTE = [
			"#4f9cf9",
			"#b48ead",
			"#7ec699",
			"#e8a87c",
			"#f07178",
			"#56b6c2",
			"#e5c07b",
			"#c678dd"
		];
		/** One row's graph gutter. */
		function Gutter(props) {
			const step = 12;
			const height = 26;
			const middle = height / 2;
			const x = (lane) => 6 + lane * step;
			const colour = (lane) => LANE_PALETTE[lane % LANE_PALETTE.length];
			const beforeIndex = new Map(props.before.map((oid, index) => [oid, index]));
			const afterIndex = new Map(props.after.map((oid, index) => [oid, index]));
			const extraParents = props.parents.slice(1);
			const openedLanes = /* @__PURE__ */ new Set();
			for (const parent of extraParents) {
				const index = afterIndex.get(parent);
				if (index !== void 0 && !beforeIndex.has(parent)) openedLanes.add(index);
			}
			const children = [];
			const coveredAfter = /* @__PURE__ */ new Set();
			props.before.forEach((oid, index) => {
				const next = afterIndex.get(oid);
				if (next === void 0 || next === index) {
					children.push(react.createElement("line", {
						key: `b${index}`,
						x1: x(index),
						y1: 0,
						x2: x(index),
						y2: middle,
						stroke: colour(index),
						strokeWidth: 1.5,
						strokeLinecap: "round"
					}));
					return;
				}
				coveredAfter.add(next);
				children.push(react.createElement("path", {
					key: `b${index}`,
					className: "dgw-laneShift",
					d: `M ${x(index)} 0 L ${x(next)} ${height}`,
					fill: "none",
					stroke: colour(next),
					strokeWidth: 1.5,
					strokeLinecap: "round"
				}));
			});
			props.after.forEach((oid, index) => {
				if (openedLanes.has(index) || coveredAfter.has(index)) return;
				children.push(react.createElement("line", {
					key: `a${index}`,
					x1: x(index),
					y1: middle,
					x2: x(index),
					y2: height,
					stroke: colour(index),
					strokeWidth: 1.5,
					strokeLinecap: "round"
				}));
			});
			extraParents.forEach((parent, index) => {
				const target = afterIndex.get(parent);
				if (target === void 0 || target === props.lane) return;
				const from = x(props.lane);
				const to = x(target);
				children.push(react.createElement("path", {
					key: `m${index}`,
					className: "dgw-mergeEdge",
					d: `M ${from} ${middle} C ${from} 20, ${to} 19, ${to} ${height}`,
					fill: "none",
					stroke: colour(target),
					strokeWidth: 1.5,
					strokeLinecap: "round"
				}));
			});
			children.push(react.createElement("circle", {
				key: "dot",
				cx: x(props.lane),
				cy: middle,
				r: 3.5,
				fill: colour(props.lane),
				stroke: "var(--dsw-alias-bg-base)",
				strokeWidth: 1.5
			}));
			return react.createElement("svg", {
				className: "dgw-gutter",
				width: props.width,
				height
			}, ...children);
		}
		/** Render the commit list. */
		function LogList(props) {
			const gutterWidth = props.graph.reduce((max, row) => Math.max(max, row.lane + 1, row.before.length, row.after.length), 1) * 12 + 8;
			const [menu, setMenu] = react.useState(null);
			react.useEffect(() => {
				if (menu === null) return void 0;
				const close = () => setMenu(null);
				const onKey = (event) => {
					if (event.key === "Escape") close();
				};
				const onOtherMenu = () => close();
				window.addEventListener("click", close);
				window.addEventListener("keydown", onKey);
				window.addEventListener("scroll", close, true);
				window.addEventListener(MENU_EXCLUSIVE_EVENT, onOtherMenu);
				return () => {
					window.removeEventListener("click", close);
					window.removeEventListener("keydown", onKey);
					window.removeEventListener("scroll", close, true);
					window.removeEventListener(MENU_EXCLUSIVE_EVENT, onOtherMenu);
				};
			}, [menu]);
			const menuItem = (label, action, key) => react.createElement("button", {
				className: "dgw-menuItem",
				type: "button",
				key: key ?? label,
				onClick: (event) => {
					event.stopPropagation();
					setMenu(null);
					action();
				}
			}, label);
			return react.createElement("div", { className: "dgw-list" }, react.createElement("div", { className: "dgw-listHead" }, props.branchLabel === null ? null : react.createElement("span", { className: "dgw-chip" }, props.branchLabel, react.createElement("button", {
				className: "dgw-iconBtn",
				style: {
					width: 16,
					height: 16
				},
				onClick: props.onClearBranch,
				title: "显示当前分支",
				type: "button",
				"aria-label": "清除分支过滤"
			}, "×")), react.createElement("span", { className: "dgw-search" }, react.createElement(SearchIcon, { size: 13 }), react.createElement("input", {
				className: "dgw-searchInput",
				type: "search",
				placeholder: "文本或哈希",
				value: props.query,
				onChange: (event) => props.onQueryChange(event.target.value),
				"aria-label": "搜索提交"
			}))), react.createElement("div", { className: "dgw-rows" }, props.commits.length === 0 ? react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, react.createElement("div", null, props.loading ? "正在加载提交…" : props.query === "" ? "没有提交" : "没有匹配的提交"))) : props.commits.map((commit, index) => {
				const graphRow = props.graph[index] ?? {
					lane: 0,
					before: [],
					after: []
				};
				const labels = refLabels(commit);
				return react.createElement("div", {
					key: commit.oid,
					className: [
						"dgw-row",
						props.selectedOid === commit.oid ? "dgw-row--active" : "",
						commit.parents.length > 1 ? "dgw-row--merge" : ""
					].filter((part) => part !== "").join(" "),
					onClick: () => props.onSelect(commit.oid),
					onContextMenu: (event) => {
						event.preventDefault();
						event.stopPropagation();
						announceMenuOpen();
						setMenu({
							x: event.clientX,
							y: event.clientY,
							commit
						});
					},
					title: `${commit.shortOid} ${commit.subject}`
				}, react.createElement(Gutter, {
					lane: graphRow.lane,
					before: graphRow.before,
					after: graphRow.after,
					parents: commit.parents,
					width: gutterWidth
				}), react.createElement("span", { className: "dgw-subject" }, commit.subject), labels.length === 0 ? null : react.createElement("span", { className: "dgw-pills" }, ...labels.slice(0, 3).map((label, labelIndex) => react.createElement("span", {
					key: `${label.text}-${labelIndex}`,
					className: label.tag ? "dgw-pill dgw-pill--tag" : "dgw-pill"
				}, label.text))), react.createElement("span", { className: "dgw-meta" }, commit.author.name), react.createElement("span", { className: "dgw-meta" }, formatWhen(commit.author.date)), react.createElement("button", {
					className: "dgw-rowMenu",
					type: "button",
					title: "提交操作",
					"aria-label": "提交操作",
					onClick: (event) => {
						event.stopPropagation();
						const rect = event.currentTarget.getBoundingClientRect();
						announceMenuOpen();
						setMenu({
							x: rect.left - 170,
							y: rect.bottom + 2,
							commit
						});
					}
				}, "⋯"));
			}), props.hasMore ? react.createElement("button", {
				className: "dgw-loadMore",
				onClick: props.onLoadMore,
				type: "button"
			}, "加载更多") : null), menu === null ? null : react.createElement("div", {
				className: "dgw-menu",
				style: {
					left: Math.max(8, Math.min(menu.x, typeof window === "undefined" ? menu.x : window.innerWidth - 200)),
					top: Math.max(8, Math.min(menu.y, typeof window === "undefined" ? menu.y : window.innerHeight - 220))
				}
			}, menuItem("复制哈希", () => copy$1(menu.commit.oid)), menuItem("创建标签…", () => props.onTagCreate(menu.commit.oid)), menuItem("拣选提交", () => props.onCherryPick(menu.commit.oid)), menuItem("撤销提交", () => props.onRevert(menu.commit.oid)), menuItem("重置到此处…", () => props.onReset(menu.commit.oid))));
		}
		/** File status colour. */
		function statusColour$1(status) {
			switch (status) {
				case "A": return "var(--dgw-added)";
				case "D": return "var(--dgw-deleted)";
				case "U": return "var(--dgw-conflict)";
				case "R":
				case "C": return "var(--dgw-modified)";
				default: return "var(--dgw-modified)";
			}
		}
		/** Copy text without surfacing a failure. */
		function copy$1(text) {
			if (typeof navigator === "undefined" || navigator.clipboard === void 0) return;
			navigator.clipboard.writeText(text).catch(() => void 0);
		}
		/** Render one commit's message, ref pills and authorship metadata. */
		function CommitMeta(props) {
			const detail = props.detail;
			return react.createElement(react.Fragment, null, react.createElement("div", { className: "dgw-msg" }, detail.message), react.createElement("div", { className: "dgw-detailRefs" }, ...refLabels(detail).map((label) => react.createElement("span", {
				key: label.text,
				className: label.tag ? "dgw-pill dgw-pill--tag" : "dgw-pill"
			}, label.text))), react.createElement("div", { className: "dgw-detailMeta" }, react.createElement("div", null, `作者 ${detail.author.name} <${detail.author.email}>，${formatWhen(detail.author.date)}`), detail.committer.date !== detail.author.date ? react.createElement("div", null, `提交于 ${formatWhen(detail.committer.date)}`) : null, detail.containedInBranches.length === 0 ? null : react.createElement("div", null, `在 ${detail.containedInBranches.length} 个分支中: ${detail.containedInBranches.join(", ")}`)));
		}
		/** Render one commit's changed-file list; the diff itself stays outside. */
		function CommitFiles(props) {
			return react.createElement(react.Fragment, null, react.createElement("div", { className: "dgw-sectionTitle" }, "更改的文件"), ...props.files.map((file) => react.createElement("div", {
				key: `${file.oldPath ?? ""}:${file.path}`,
				className: `dgw-fileRow${props.selectedFile === file.path ? " dgw-fileRow--active" : ""}`,
				onClick: () => props.onSelectFile(file.path),
				title: file.path
			}, react.createElement(FileIcon, { size: 14 }), react.createElement("span", { className: "dgw-filePath" }, file.path), react.createElement("span", {
				className: "dgw-fileStat",
				style: { color: statusColour$1(file.status) }
			}, file.status), file.binary ? react.createElement("span", { className: "dgw-fileStat" }, "二进制") : react.createElement("span", { className: "dgw-fileStat" }, react.createElement("span", { className: "dgw-fileStat--add" }, `+${String(file.additions ?? 0)}`), " ", react.createElement("span", { className: "dgw-fileStat--del" }, `-${String(file.deletions ?? 0)}`)))));
		}
		/** Render the commit-detail column. */
		function DetailPane(props) {
			if (props.detail === null) return react.createElement("div", { className: "dgw-detail" }, react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, react.createElement("div", null, props.loading ? "正在加载提交详情…" : "选择一个提交查看详情"))));
			const detail = props.detail;
			return react.createElement("div", { className: "dgw-detail" }, react.createElement("div", { className: "dgw-detailHead" }, react.createElement("span", { className: "dgw-hash" }, detail.shortOid), react.createElement("button", {
				className: "dgw-iconBtn",
				type: "button",
				title: "复制完整哈希",
				onClick: () => copy$1(detail.oid)
			}, react.createElement(CopyIcon, { size: 13 })), react.createElement("span", { className: "dgw-spacer" }), react.createElement("span", { className: "dgw-meta" }, `${detail.files.length} 个文件`)), react.createElement("div", { className: "dgw-detailScroll" }, react.createElement(CommitMeta, { detail }), react.createElement(CommitFiles, {
				files: detail.files,
				selectedFile: props.selectedFile,
				onSelectFile: props.onSelectFile
			})), react.createElement(DiffView, {
				diff: props.diff,
				file: props.selectedFile,
				loading: props.diffLoading,
				mode: "unified"
			}));
		}
		//#endregion
		//#region src/git-workspace/window/runtime.ts
		/** Route family shared with the Host half. */
		const ROUTE$1 = "/plugin-git-workspace";
		/** One failed round-trip, already decoded from the Host envelope. */
		var GitApiError = class extends Error {
			code;
			detail;
			constructor(code, message, detail) {
				super(message);
				this.name = "GitApiError";
				this.code = code;
				this.detail = detail;
			}
		};
		/** Chinese copy for the stable Host error codes. */
		const ERROR_COPY = {
			"git-not-found": "没有找到 git 可执行文件，请先安装 git。",
			"not-a-repository": "当前工作区不是 git 仓库。",
			"workspace-not-found": "找不到这个工作区，请刷新后重试。",
			"invalid-path": "路径无效或不在当前仓库内。",
			"invalid-ref": "分支或提交不存在，可能已被删除。",
			"invalid-request": "请求参数无效，请刷新后重试。",
			busy: "正在执行另一个 Git 操作，请稍候。",
			lock: "另一个 git 进程正在操作仓库（index.lock 存在）。",
			conflict: "操作产生冲突，请解决冲突后继续或中止。",
			"stash-conflict": "搁置内容与当前文件冲突：请解决冲突并暂存文件；该搁置仍保留，可稍后用「丢弃搁置」删除。",
			"nothing-to-commit": "没有要提交的内容。",
			"confirmation-required": "这个操作需要确认后才能执行。",
			"confirmation-mismatch": "确认信息与当前操作不匹配，请重新确认。",
			"branch-not-merged": "分支还有未合并的提交，确认删除请勾选强制删除。",
			"branch-checked-out": "不能删除当前已检出的分支，请先切换到其他分支。",
			"dirty-worktree": "工作区有未提交的更改，请先提交或搁置。",
			"no-upstream": "当前分支没有上游分支，请先设置跟踪。",
			"auth-required": "Git 认证失败：请先在终端配置 SSH key 或凭据。",
			"safe-directory": "仓库属主与当前用户不一致，请按提示配置 safe.directory。",
			network: "无法连接远端仓库，请检查网络后重试。",
			timeout: "操作超时，请检查网络或仓库大小后重试。",
			"push-rejected": "推送被拒绝：远端有新的提交，请先获取并合并。",
			"hook-failed": "提交被 Git 钩子阻止，请查看输出。",
			"detached-head": "当前处于分离 HEAD 状态，请先检出一个分支。",
			cancelled: "操作已取消；若已生效请刷新查看。",
			"unsupported-action": "这个操作尚未支持。",
			"parse-failed": "Host 无法解析 git 输出，请刷新后重试。",
			internal: "Host 内部错误，请重试；持续失败请查看 DSH 日志。"
		};
		/**
		* Localize one Host error code, falling back to the Host message.
		* @param code - stable error code.
		* @param fallback - Host message when the code is unknown.
		* @returns display text.
		*/
		function describeGitError(code, fallback) {
			return ERROR_COPY[code] ?? fallback;
		}
		/** Wait one beat between job polls. */
		function sleep(ms) {
			return new Promise((resolve) => setTimeout(resolve, ms));
		}
		/**
		* Follow a background job until it settles.
		* @param api - the Git window runtime.
		* @param id - job id.
		* @param onUpdate - called on every observed state.
		* @param signal - optional cancellation of the wait itself.
		* @returns the settled job view.
		*/
		async function waitForJob(api, id, onUpdate, signal) {
			let transportFailures = 0;
			for (;;) {
				if (signal?.aborted === true) throw new GitApiError("cancelled", "the job wait was cancelled");
				try {
					const view = await api.job(id, signal);
					onUpdate?.(view);
					if (view.status !== "running") return view;
					transportFailures = 0;
				} catch (error) {
					transportFailures += 1;
					if (transportFailures > 10) throw error;
				}
				await sleep(600);
			}
		}
		/** Whether a thrown value is an abort from a replaced request. */
		function isAbortError$1(error) {
			return typeof error === "object" && error !== null && error.name === "AbortError";
		}
		/** Build a query string, omitting undefined/empty values. */
		function queryString(params) {
			const search = new URLSearchParams();
			for (const [key, value] of Object.entries(params)) {
				if (value === void 0) continue;
				if (typeof value === "string" && value === "") continue;
				search.set(key, String(value));
			}
			const text = search.toString();
			return text === "" ? "" : `?${text}`;
		}
		/** GET one route and decode its envelope. */
		async function getJson(path, signal) {
			const init = {
				method: "GET",
				cache: "no-store"
			};
			if (signal !== void 0) init.signal = signal;
			const response = await fetch(new URL(path, document.baseURI), init);
			const text = await response.text();
			let body;
			try {
				body = text === "" ? void 0 : JSON.parse(text);
			} catch {
				throw new GitApiError("bad-response", `Host 返回了无法解析的响应（HTTP ${response.status}）`);
			}
			const envelope = body;
			if (envelope === void 0 || envelope.ok !== true) {
				const failure = envelope?.error;
				throw new GitApiError(typeof failure?.code === "string" ? failure.code : "bad-response", typeof failure?.message === "string" ? failure.message : `HTTP ${response.status}`, typeof failure?.detail === "string" ? failure.detail : void 0);
			}
			return envelope;
		}
		/** POST one route and decode its envelope. */
		async function postJson(path, body, signal) {
			const init = {
				method: "POST",
				cache: "no-store",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			};
			if (signal !== void 0) init.signal = signal;
			const response = await fetch(new URL(path, document.baseURI), init);
			const text = await response.text();
			let decoded;
			try {
				decoded = text === "" ? void 0 : JSON.parse(text);
			} catch {
				throw new GitApiError("bad-response", `Host 返回了无法解析的响应（HTTP ${response.status}）`);
			}
			const envelope = decoded;
			if (envelope === void 0 || envelope.ok !== true) {
				const failure = envelope?.error;
				throw new GitApiError(typeof failure?.code === "string" ? failure.code : "bad-response", typeof failure?.message === "string" ? failure.message : `HTTP ${response.status}`, typeof failure?.detail === "string" ? failure.detail : void 0);
			}
			return envelope;
		}
		/** Build the live runtime over `fetch`. */
		function createGitWindowRuntime() {
			return {
				async snapshot(workspaceId, signal) {
					return await getJson(`${ROUTE$1}/snapshot${queryString({ workspaceId })}`, signal);
				},
				async log(request, signal) {
					return await getJson(`${ROUTE$1}/log${queryString({
						workspaceId: request.workspaceId,
						ref: request.ref,
						limit: request.limit,
						skip: request.skip,
						query: request.query,
						author: request.author,
						since: request.since,
						until: request.until,
						file: request.file
					})}`, signal);
				},
				async commit(workspaceId, hash, signal) {
					return await getJson(`${ROUTE$1}/commit${queryString({
						workspaceId,
						hash
					})}`, signal);
				},
				async diff(request, signal) {
					return await getJson(`${ROUTE$1}/diff${queryString({
						workspaceId: request.workspaceId,
						hash: request.hash,
						file: request.file,
						staged: request.staged === true ? 1 : void 0,
						context: request.context ?? 3
					})}`, signal);
				},
				async pushPreview(workspaceId, signal) {
					return await getJson(`${ROUTE$1}/push-preview${queryString({ workspaceId })}`, signal);
				},
				async confirm(action, signal) {
					return await postJson(`${ROUTE$1}/confirm`, action, signal);
				},
				async action(action, confirmToken, signal) {
					const body = confirmToken === void 0 ? action : {
						...action,
						confirm: confirmToken
					};
					return await postJson(`${ROUTE$1}/action`, body, signal);
				},
				async job(id, signal) {
					return (await getJson(`${ROUTE$1}/job${queryString({ id })}`, signal)).job;
				},
				async cancelJob(id, signal) {
					return (await postJson(`${ROUTE$1}/cancel`, { id }, signal)).job;
				}
			};
		}
		//#endregion
		//#region src/git-workspace/window/branch.ts
		/**
		* Branch dialogs: create, rename and delete. They are presentation only; the
		* shell owns the action round-trip and the confirmation token for delete.
		*
		* @module dsh-session-map/git-workspace/window/branch
		*/
		/** Titles and confirm labels per operation. */
		const COPY$1 = {
			create: {
				title: "新建分支",
				confirm: "创建并检出"
			},
			rename: {
				title: "重命名分支",
				confirm: "重命名"
			},
			delete: {
				title: "删除分支",
				confirm: "删除"
			}
		};
		/** Render one branch dialog. */
		function BranchDialog(props) {
			const copy = COPY$1[props.prompt.kind];
			return react.createElement("div", { className: "dgw-modalBackdrop" }, react.createElement("div", {
				className: "dgw-modal",
				role: "dialog",
				"aria-label": copy.title
			}, react.createElement("div", { className: "dgw-modalTitle" }, copy.title), props.prompt.kind === "delete" ? react.createElement("div", { className: "dgw-modalText" }, `将删除分支 ${props.prompt.branch ?? ""}。未合并的分支默认会被 git 拒绝。`) : react.createElement(react.Fragment, null, react.createElement("label", { className: "dgw-fieldLabel" }, props.prompt.kind === "create" ? "新分支名" : "新名称"), react.createElement("input", {
				className: "dgw-input",
				value: props.value,
				autoFocus: true,
				onChange: (event) => props.onValue(event.target.value),
				placeholder: props.prompt.kind === "rename" ? props.prompt.branch ?? "" : "feature/my-branch",
				"aria-label": props.prompt.kind === "create" ? "新分支名" : "新名称"
			}), props.prompt.kind === "create" && props.prompt.start !== void 0 ? react.createElement("div", { className: "dgw-fieldLabel" }, `起点：${props.prompt.start}`) : null), props.prompt.kind === "delete" ? react.createElement("label", { className: "dgw-label" }, react.createElement("input", {
				type: "checkbox",
				checked: props.force,
				onChange: (event) => props.onForce(event.target.checked)
			}), "强制删除未合并的分支（-D）") : null, props.error === null ? null : react.createElement("div", { className: "dgw-inlineError" }, describeGitError(props.error.code, props.error.message)), react.createElement("div", { className: "dgw-modalActions" }, react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				onClick: props.onCancel,
				disabled: props.busy
			}, "取消"), react.createElement("button", {
				className: props.prompt.kind === "delete" ? "dgw-btn dgw-btn--danger" : "dgw-btn dgw-btn--primary",
				type: "button",
				onClick: props.onConfirm,
				disabled: props.busy
			}, copy.confirm))));
		}
		//#endregion
		//#region src/git-workspace/window/history.ts
		/**
		* Reset and tag dialogs: presentation only. The shell owns the confirmation
		* token for reset and the action round-trip for both.
		*
		* @module dsh-session-map/git-workspace/window/history
		*/
		/** Render the tag-creation dialog. */
		function TagDialog(props) {
			return react.createElement("div", { className: "dgw-modalBackdrop" }, react.createElement("div", {
				className: "dgw-modal",
				role: "dialog",
				"aria-label": "创建标签"
			}, react.createElement("div", { className: "dgw-modalTitle" }, "创建标签"), react.createElement("div", { className: "dgw-modalText" }, `在提交 ${props.hash.slice(0, 8)} 上创建一个轻量标签。`), react.createElement("input", {
				className: "dgw-input",
				value: props.value,
				autoFocus: true,
				placeholder: "v1.0.0",
				onChange: (event) => props.onValue(event.target.value),
				"aria-label": "标签名"
			}), props.error === null ? null : react.createElement("div", { className: "dgw-inlineError" }, describeGitError(props.error.code, props.error.message)), react.createElement("div", { className: "dgw-modalActions" }, react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				onClick: props.onCancel,
				disabled: props.busy
			}, "取消"), react.createElement("button", {
				className: "dgw-btn dgw-btn--primary",
				type: "button",
				onClick: props.onConfirm,
				disabled: props.busy
			}, "创建"))));
		}
		/** Render the tag-deletion confirmation. */
		function TagDeleteDialog(props) {
			return react.createElement("div", { className: "dgw-modalBackdrop" }, react.createElement("div", {
				className: "dgw-modal",
				role: "alertdialog",
				"aria-label": "删除标签"
			}, react.createElement("div", { className: "dgw-modalTitle" }, "删除标签"), react.createElement("div", { className: "dgw-modalText" }, `将删除标签 ${props.name}。本地删除不会影响远端，除非另行推送删除。`), props.error === null ? null : react.createElement("div", { className: "dgw-inlineError" }, describeGitError(props.error.code, props.error.message)), react.createElement("div", { className: "dgw-modalActions" }, react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				onClick: props.onCancel,
				disabled: props.busy
			}, "取消"), react.createElement("button", {
				className: "dgw-btn dgw-btn--danger",
				type: "button",
				onClick: props.onConfirm,
				disabled: props.busy
			}, "删除标签"))));
		}
		/** Render the forced-push confirmation. */
		function ForcePushDialog(props) {
			return react.createElement("div", { className: "dgw-modalBackdrop" }, react.createElement("div", {
				className: "dgw-modal",
				role: "alertdialog",
				"aria-label": "强制推送"
			}, react.createElement("div", { className: "dgw-modalTitle" }, "强制推送（--force-with-lease）"), react.createElement("div", { className: "dgw-modalText" }, `将用本地 ${props.branch} 覆盖远端同名分支。若远端已有他人的新提交，lease 校验会拒绝本次推送；否则远端历史会被改写，影响其他协作者。`), props.error === null ? null : react.createElement("div", { className: "dgw-inlineError" }, describeGitError(props.error.code, props.error.message)), react.createElement("div", { className: "dgw-modalActions" }, react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				onClick: props.onCancel,
				disabled: props.busy
			}, "取消"), react.createElement("button", {
				className: "dgw-btn dgw-btn--danger",
				type: "button",
				onClick: props.onConfirm,
				disabled: props.busy
			}, "强制推送"))));
		}
		/** Render the reset dialog. */
		function ResetDialog(props) {
			return react.createElement("div", { className: "dgw-modalBackdrop" }, react.createElement("div", {
				className: "dgw-modal",
				role: "dialog",
				"aria-label": "重置当前分支"
			}, react.createElement("div", { className: "dgw-modalTitle" }, "重置当前分支"), react.createElement("div", { className: "dgw-modalText" }, `把当前分支重置到 ${props.hash.slice(0, 8)}。`), react.createElement("select", {
				className: "dgw-select",
				value: props.mode,
				onChange: (event) => props.onMode(event.target.value),
				"aria-label": "重置模式"
			}, react.createElement("option", { value: "soft" }, "Soft：移动 HEAD，保留暂存区和工作区"), react.createElement("option", { value: "mixed" }, "Mixed：移动 HEAD，保留工作区，清空暂存区"), react.createElement("option", { value: "hard" }, "Hard：移动 HEAD，丢弃暂存区和工作区更改")), props.mode === "hard" ? react.createElement("div", { className: "dgw-inlineError" }, "Hard 模式会丢失未提交的更改，此操作不可撤销。") : null, props.error === null ? null : react.createElement("div", { className: "dgw-inlineError" }, describeGitError(props.error.code, props.error.message)), react.createElement("div", { className: "dgw-modalActions" }, react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				onClick: props.onCancel,
				disabled: props.busy
			}, "取消"), react.createElement("button", {
				className: props.mode === "hard" ? "dgw-btn dgw-btn--danger" : "dgw-btn dgw-btn--primary",
				type: "button",
				onClick: props.onConfirm,
				disabled: props.busy
			}, "重置"))));
		}
		//#endregion
		//#region src/git-workspace/window/update-dialog.ts
		/**
		* The "update current branch" dialog: choose merge vs rebase, optionally stop
		* asking, and jump to the existing destructive-reset flow.
		*
		* @module dsh-session-map/git-workspace/window/update-dialog
		*/
		/** Browser-local key for the update preference. */
		const UPDATE_PREF_KEY = "dsh.git-window.updateMode";
		/** Default preference: merge. */
		const DEFAULT_UPDATE_MODE = "merge";
		/** Read the last chosen mode; a denied or malformed store falls back to merge. */
		function readUpdateMode() {
			if (typeof localStorage === "undefined") return DEFAULT_UPDATE_MODE;
			try {
				const raw = localStorage.getItem(UPDATE_PREF_KEY);
				if (raw === null) return DEFAULT_UPDATE_MODE;
				if (raw === "rebase" || raw === "merge") return raw;
				return JSON.parse(raw).mode === "rebase" ? "rebase" : "merge";
			} catch {
				return DEFAULT_UPDATE_MODE;
			}
		}
		/** Persist the last chosen mode; denial is not an error. */
		function writeUpdateMode(mode) {
			if (typeof localStorage === "undefined") return;
			try {
				localStorage.setItem(UPDATE_PREF_KEY, mode);
			} catch {}
		}
		/** Render IDEA-style update options. */
		function UpdateDialog(props) {
			return react.createElement("div", { className: "dgw-modalBackdrop" }, react.createElement("div", {
				className: "dgw-modal",
				role: "dialog",
				"aria-label": "更新当前分支"
			}, react.createElement("div", { className: "dgw-modalTitle" }, "更新当前分支"), react.createElement("div", { className: "dgw-modalText" }, "先下载远端状态，再把上游的传入更改应用到当前分支。"), react.createElement("label", { className: "dgw-choice" }, react.createElement("input", {
				type: "radio",
				name: "dgw-update-mode",
				checked: props.mode === "merge",
				onChange: () => props.onMode("merge")
			}), "将传入更改合并到当前分支"), react.createElement("label", { className: "dgw-choice" }, react.createElement("input", {
				type: "radio",
				name: "dgw-update-mode",
				checked: props.mode === "rebase",
				onChange: () => props.onMode("rebase")
			}), "在传入更改上变基当前分支"), react.createElement("div", { className: "dgw-modalActions" }, react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				title: props.canReset ? "把当前分支硬重置到上游远端" : "当前分支没有可用的上游远端",
				disabled: props.busy || !props.canReset,
				onClick: props.onReset
			}, "重置到远程分支…"), react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				onClick: props.onCancel,
				disabled: props.busy
			}, "取消"), react.createElement("button", {
				className: "dgw-btn dgw-btn--primary",
				type: "button",
				onClick: props.onConfirm,
				disabled: props.busy
			}, "确定"))));
		}
		//#endregion
		//#region src/git-workspace/window/push-dialog.ts
		/**
		* Push preview dialog: what would be sent to the upstream, shown before the
		* push job starts.
		*
		* @module dsh-session-map/git-workspace/window/push-dialog
		*/
		/** Render one push-preview row's stat summary. */
		function fileStats(additions, deletions, binary) {
			if (binary) return "二进制";
			return `+${additions ?? 0} −${deletions ?? 0}`;
		}
		/** Build a directory tree from the preview's flat file list. */
		function buildPreviewTree(files) {
			const root = {
				name: "",
				path: "",
				folders: /* @__PURE__ */ new Map(),
				files: []
			};
			for (const file of files) {
				const parts = file.path.split("/");
				let node = root;
				for (let index = 0; index < parts.length - 1; index += 1) {
					const name = parts[index];
					const path = node.path === "" ? name : `${node.path}/${name}`;
					let child = node.folders.get(name);
					if (child === void 0) {
						child = {
							name,
							path,
							folders: /* @__PURE__ */ new Map(),
							files: []
						};
						node.folders.set(name, child);
					}
					node = child;
				}
				node.files.push(file);
			}
			return root;
		}
		/** Total files under one preview folder. */
		function countPreviewFiles(folder) {
			let total = folder.files.length;
			for (const child of folder.folders.values()) total += countPreviewFiles(child);
			return total;
		}
		/** Render one folder's children, indented by depth. */
		function renderPreviewFolder(folder, depth) {
			const rows = [];
			for (const child of [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
				rows.push(react.createElement("div", {
					className: "dgw-pushFolder",
					key: `d:${child.path}`,
					style: { paddingLeft: 8 + depth * 14 }
				}, react.createElement(FolderIcon, { size: 13 }), react.createElement("span", { className: "dgw-pushFolderName" }, child.name), react.createElement("span", { className: "dgw-meta" }, `${countPreviewFiles(child)} 个文件`)));
				rows.push(...renderPreviewFolder(child, depth + 1));
			}
			for (const file of [...folder.files].sort((a, b) => a.path.localeCompare(b.path))) rows.push(react.createElement("div", {
				className: "dgw-pushFile",
				key: file.path,
				style: { paddingLeft: 8 + depth * 14 },
				title: file.path
			}, react.createElement(FileIcon, { size: 13 }), react.createElement("span", { className: "dgw-pushFileStatus" }, file.status), react.createElement("span", { className: "dgw-pushFilePath" }, file.path.split("/").pop() ?? file.path), react.createElement("span", { className: "dgw-meta" }, fileStats(file.additions, file.deletions, file.binary))));
			return rows;
		}
		/** Render the push preview. */
		function PushDialog(props) {
			const target = props.upstream ?? `${props.remote ?? "origin"}/${props.branch}`;
			const createsUpstream = props.upstream === null;
			const [selectedOid, setSelectedOid] = react.useState(null);
			const [selectedDetail, setSelectedDetail] = react.useState(null);
			const [detailLoading, setDetailLoading] = react.useState(false);
			const [detailError, setDetailError] = react.useState(null);
			const [commitsOpen, setCommitsOpen] = react.useState(true);
			const files = selectedOid === null ? props.preview?.files ?? [] : selectedDetail?.files ?? [];
			const fileTree = buildPreviewTree(files);
			const showAll = () => {
				setSelectedOid(null);
				setSelectedDetail(null);
				setDetailError(null);
			};
			const selectCommit = async (oid) => {
				setSelectedOid(oid);
				setSelectedDetail(null);
				setDetailLoading(true);
				setDetailError(null);
				try {
					setSelectedDetail(await props.loadCommit(oid));
				} catch (error) {
					setDetailError(error instanceof Error ? error.message : String(error));
				} finally {
					setDetailLoading(false);
				}
			};
			const filesTitle = selectedOid === null ? `全部变更（${props.preview?.files.length ?? 0}）` : `提交 ${selectedDetail?.shortOid ?? selectedOid.slice(0, 7)} 的文件（${files.length}）`;
			return react.createElement("div", { className: "dgw-modalBackdrop" }, react.createElement("div", {
				className: "dgw-modal dgw-pushModal",
				role: "dialog",
				"aria-label": "推送当前分支"
			}, react.createElement("div", { className: "dgw-modalTitle" }, "推送当前分支"), props.loading ? react.createElement("div", { className: "dgw-loading" }, "正在计算待推送提交…") : null, props.error === null ? null : react.createElement("div", { className: "dgw-inlineError" }, props.error), props.preview === null || props.loading ? null : react.createElement("div", { className: "dgw-pushBody" }, react.createElement("div", { className: "dgw-pushLeft" }, react.createElement("div", {
				className: "dgw-pushMapping" + (selectedOid === null ? " dgw-pushMapping--active" : ""),
				onClick: showAll,
				title: "查看全部待推送文件"
			}, react.createElement("button", {
				className: "dgw-pushBranchToggle",
				type: "button",
				"data-open": commitsOpen,
				"aria-label": commitsOpen ? "收起提交列表" : "展开提交列表",
				onClick: (event) => {
					event.stopPropagation();
					setCommitsOpen((open) => !open);
				}
			}, react.createElement(ChevronIcon, { size: 12 })), react.createElement("span", { className: "dgw-pushMappingText" }, `${props.branch} → ${target}`, createsUpstream ? "（将建立上游跟踪）" : ""), react.createElement("span", { className: "dgw-meta" }, `${props.preview.commits.length} 个提交`)), createsUpstream ? react.createElement("div", { className: "dgw-pushEmpty" }, "当前分支还没有上游，无法预览待推送提交") : commitsOpen ? react.createElement("div", { className: "dgw-pushCommits" }, ...props.preview.commits.map((commit) => react.createElement("div", {
				className: "dgw-pushCommit" + (selectedOid === commit.oid ? " dgw-pushCommit--active" : ""),
				key: commit.oid,
				title: commit.subject,
				onClick: () => {
					selectCommit(commit.oid);
				}
			}, react.createElement("span", { className: "dgw-pushSubject" }, commit.subject), react.createElement("span", { className: "dgw-meta" }, commit.author.name)))) : null, props.preview.truncated ? react.createElement("div", { className: "dgw-meta" }, "提交较多，仅显示最近 100 条") : null), react.createElement("div", { className: "dgw-pushRight" }, react.createElement("div", { className: "dgw-pushSectionHead" }, filesTitle), detailLoading ? react.createElement("div", { className: "dgw-pushEmpty" }, "正在读取提交文件…") : detailError === null ? react.createElement("div", { className: "dgw-pushFiles" }, ...renderPreviewFolder(fileTree, 0)) : react.createElement("div", { className: "dgw-inlineError" }, detailError))), react.createElement("div", { className: "dgw-pushFooter" }, props.canForce ? react.createElement("label", { className: "dgw-choice" }, react.createElement("input", {
				type: "checkbox",
				checked: props.force,
				onChange: (event) => props.onForce(event.target.checked)
			}), "强制推送（--force-with-lease，会再次确认）") : null, react.createElement("span", { className: "dgw-spacer" }), react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				onClick: props.onCancel,
				disabled: props.busy
			}, "取消"), react.createElement("button", {
				className: props.force ? "dgw-btn dgw-btn--danger" : "dgw-btn dgw-btn--primary",
				type: "button",
				onClick: props.onPush,
				disabled: props.busy || props.loading || props.preview === null
			}, props.force ? "强制推送" : "推送"))));
		}
		//#endregion
		//#region src/git-workspace/window/commit.ts
		/**
		* Commit pane: staging, discarding and committing with server-enforced
		* confirmation. The pane never runs a git command itself; every control is a
		* round-trip that returns the command receipts the console shows.
		*
		* @module dsh-session-map/git-workspace/window/commit
		*/
		/** Normalize one thrown value. */
		function asApiError(error) {
			return error instanceof GitApiError ? error : new GitApiError("internal", error instanceof Error ? error.message : String(error));
		}
		/** Status colour for one change row. */
		function statusColour(entry) {
			switch (entry.status) {
				case "A": return "var(--dgw-added)";
				case "D": return "var(--dgw-deleted)";
				case "U": return "var(--dgw-conflict)";
				case "?": return "var(--dgw-untracked)";
				default: return "var(--dgw-modified)";
			}
		}
		/** Build a directory tree for one section's rows. */
		function buildChangeTree(rows) {
			const root = {
				name: "",
				path: "",
				dirs: /* @__PURE__ */ new Map(),
				files: []
			};
			for (const entry of rows) {
				const parts = entry.path.split("/");
				let node = root;
				for (let index = 0; index < parts.length - 1; index += 1) {
					const name = parts[index];
					const path = node.path === "" ? name : `${node.path}/${name}`;
					let child = node.dirs.get(name);
					if (child === void 0) {
						child = {
							name,
							path,
							dirs: /* @__PURE__ */ new Map(),
							files: []
						};
						node.dirs.set(name, child);
					}
					node = child;
				}
				node.files.push(entry);
			}
			const sort = (node) => {
				node.files.sort((left, right) => left.path.localeCompare(right.path));
				for (const child of node.dirs.values()) sort(child);
			};
			sort(root);
			return {
				files: root.files,
				dirs: [...root.dirs.values()]
			};
		}
		/** Every directory path referenced by one change set, for expand/collapse-all. */
		function allChangeDirPaths(rows) {
			const paths = /* @__PURE__ */ new Set();
			for (const entry of rows) {
				const parts = entry.path.split("/");
				let prefix = "";
				for (let index = 0; index < parts.length - 1; index += 1) {
					prefix = prefix === "" ? parts[index] : `${prefix}/${parts[index]}`;
					paths.add(prefix);
				}
			}
			return [...paths];
		}
		/** Count total files under one directory node (including nested directories). */
		function countFiles(node) {
			let total = node.files.length;
			for (const child of node.dirs.values()) total += countFiles(child);
			return total;
		}
		/** IDEA-style single-child chains collapsed into one row. */
		function compactDir(node) {
			let current = node;
			let label = node.name;
			while (current.files.length === 0 && current.dirs.size === 1) {
				const only = [...current.dirs.values()][0];
				if (only === void 0) break;
				label += `/${only.name}`;
				current = only;
			}
			return {
				node: current,
				label
			};
		}
		/** One guide line per nesting level. */
		function depthGuides(depth, prefix) {
			return Array.from({ length: depth }, (_, index) => react.createElement("span", {
				className: "dgw-changeGuide",
				key: `${prefix}-g${index}`
			}));
		}
		/** Render one change row. */
		function changeRow(entry, checked, disabled, onToggle, onDiscard, options) {
			const activate = options.onSelect ?? onToggle;
			const depth = options.depth ?? 0;
			const classes = ["dgw-changeRow", options.selected ? "dgw-changeRow--active" : ""].filter((part) => part !== "").join(" ");
			const fullPath = entry.oldPath === void 0 ? entry.path : `${entry.oldPath} → ${entry.path}`;
			const label = options.label ?? fullPath;
			const checkbox = options.onSelect === void 0 ? react.createElement("span", {
				className: "dgw-checkbox",
				"data-checked": checked,
				"aria-hidden": true
			}, checked ? "✓" : "") : react.createElement("button", {
				className: "dgw-checkbox dgw-checkbox--button",
				type: "button",
				"data-checked": checked,
				"aria-pressed": checked,
				title: checked ? "取消暂存" : "暂存",
				"aria-label": checked ? "取消暂存" : "暂存",
				onClick: (event) => {
					event.stopPropagation();
					onToggle();
				}
			}, checked ? "✓" : "");
			return react.createElement("div", {
				key: `${entry.group}:${entry.path}`,
				className: classes,
				style: { paddingLeft: 14 },
				onClick: disabled ? void 0 : activate,
				title: fullPath
			}, ...depthGuides(depth, entry.path), checkbox, react.createElement(FileIcon, { size: 13 }), react.createElement("span", { className: "dgw-changePath" }, label), react.createElement("span", {
				className: "dgw-changeStatus",
				style: { color: statusColour(entry) }
			}, entry.status), onDiscard === void 0 ? null : react.createElement("button", {
				className: "dgw-discard",
				type: "button",
				title: "丢弃更改…",
				onClick: (event) => {
					event.stopPropagation();
					onDiscard();
				}
			}, "丢弃…"));
		}
		/** Render the commit tab. */
		function CommitPane(props) {
			const { runtime, workspaceId, snapshot, onChanged } = props;
			const [message, setMessage] = react.useState("");
			const [amend, setAmend] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [discardRequest, setDiscardRequest] = react.useState(null);
			const [dropStashPending, setDropStashPending] = react.useState(false);
			const [collapsedDirs, setCollapsedDirs] = react.useState({});
			const [collapsedSections, setCollapsedSections] = react.useState({});
			const changeFolderPaths = allChangeDirPaths(snapshot.changes);
			const expandAllDirs = () => setCollapsedDirs({});
			const collapseAllDirs = () => {
				setCollapsedDirs(Object.fromEntries(changeFolderPaths.map((path) => [path, true])));
			};
			const staged = snapshot.changes.filter((entry) => entry.group === "staged");
			const unstaged = snapshot.changes.filter((entry) => entry.group === "unstaged");
			const untracked = snapshot.changes.filter((entry) => entry.group === "untracked");
			const conflicts = snapshot.changes.filter((entry) => entry.group === "conflict");
			const clean = staged.length + unstaged.length + untracked.length + conflicts.length === 0;
			const run = async (action, confirmToken) => {
				setBusy(true);
				setError(null);
				try {
					await runtime.action(action, confirmToken);
					onChanged();
					return true;
				} catch (failure) {
					setError(asApiError(failure));
					return false;
				} finally {
					setBusy(false);
				}
			};
			const toggle = async (entry) => {
				if (busy) return;
				if (entry.group === "staged") await run({
					kind: "unstage",
					workspaceId,
					paths: [entry.path]
				});
				else if (entry.group === "unstaged" || entry.group === "untracked") await run({
					kind: "stage",
					workspaceId,
					paths: [entry.path]
				});
			};
			const requestDiscard = (entry) => {
				if (entry.group === "untracked") setDiscardRequest({
					tracked: [],
					untracked: [entry.path],
					label: entry.path
				});
				else if (entry.group === "unstaged") setDiscardRequest({
					tracked: [entry.path],
					untracked: [],
					label: entry.path
				});
			};
			const confirmDiscard = async () => {
				const request = discardRequest;
				if (request === null) return;
				setBusy(true);
				setError(null);
				try {
					const action = {
						kind: "discard",
						workspaceId,
						tracked: request.tracked,
						untracked: request.untracked
					};
					const confirmation = await runtime.confirm(action);
					await runtime.action(action, confirmation.token);
					setDiscardRequest(null);
					onChanged();
				} catch (failure) {
					setError(asApiError(failure));
				} finally {
					setBusy(false);
				}
			};
			const commit = async (push) => {
				const text = message.trim();
				if (text === "" || busy) return;
				const action = {
					kind: "commit",
					workspaceId,
					message: text,
					amend
				};
				setBusy(true);
				setError(null);
				try {
					await runtime.action(action);
					if (push) {
						const branch = snapshot.head.branch;
						if (branch === null) throw new GitApiError("detached-head", "HEAD is detached");
						const remote = snapshot.remotes[0]?.name;
						const needsUpstream = snapshot.head.upstream === null;
						if (needsUpstream && remote === void 0) throw new GitApiError("no-upstream", "no remote is configured");
						await runtime.action({
							kind: "push",
							workspaceId,
							...needsUpstream && remote !== void 0 ? {
								remote,
								branch,
								setUpstream: true
							} : {}
						}).then(async (result) => {
							if (result.job === void 0) return;
							const settled = await waitForJob(runtime, result.job.id);
							if (settled.status === "failed") throw new GitApiError(settled.error?.code ?? "internal", settled.error?.message ?? "the push failed", settled.error?.detail);
							if (settled.status === "cancelled") throw new GitApiError("cancelled", "推送已取消");
						});
					}
					setMessage("");
					setAmend(false);
					onChanged();
				} catch (failure) {
					setError(asApiError(failure));
				} finally {
					setBusy(false);
				}
			};
			/** Drop the latest stash after an explicit confirmation token. */
			const confirmDropStash = async () => {
				setBusy(true);
				setError(null);
				try {
					const action = {
						kind: "stashDrop",
						workspaceId
					};
					const confirmation = await runtime.confirm(action);
					await runtime.action(action, confirmation.token);
					setDropStashPending(false);
					onChanged();
				} catch (failure) {
					setError(asApiError(failure));
				} finally {
					setBusy(false);
				}
			};
			const sections = [
				{
					title: `冲突 (${conflicts.length})`,
					rows: conflicts,
					checked: false,
					discardable: false
				},
				{
					title: `暂存区 (${staged.length})`,
					rows: staged,
					checked: true,
					discardable: false
				},
				{
					title: `未暂存 (${unstaged.length})`,
					rows: unstaged,
					checked: false,
					discardable: true
				},
				{
					title: `未版本控制 (${untracked.length})`,
					rows: untracked,
					checked: false,
					discardable: true
				}
			];
			/** Render one section's rows, flat or as a nested directory tree. */
			const renderRows = (rows, checked, discardable) => {
				const nodes = [];
				const emit = (entry, depth) => {
					nodes.push(changeRow(entry, checked, busy || entry.group === "conflict", () => {
						toggle(entry);
					}, discardable ? () => requestDiscard(entry) : void 0, {
						selected: props.selectedKey === `${entry.group}:${entry.path}`,
						...props.onSelect === void 0 ? {} : { onSelect: () => {
							props.onSelect?.(entry);
						} },
						depth,
						label: entry.path.split("/").pop() ?? entry.path
					}));
				};
				if (props.groupByDirectory !== true) {
					for (const entry of rows) emit(entry, 0);
					return nodes;
				}
				const tree = buildChangeTree(rows);
				for (const entry of tree.files) emit(entry, 0);
				const emitDir = (raw, depth) => {
					const { node, label } = compactDir(raw);
					const open = collapsedDirs[node.path] !== true;
					nodes.push(react.createElement("button", {
						key: `dir:${node.path}`,
						className: "dgw-changeDir",
						type: "button",
						title: node.path,
						style: { paddingLeft: 14 },
						onClick: () => setCollapsedDirs((state) => ({
							...state,
							[node.path]: open
						}))
					}, ...depthGuides(depth, node.path), react.createElement("span", {
						className: "dgw-changeChevron",
						"data-open": open ? "true" : "false"
					}, react.createElement(ChevronIcon, { size: 11 })), react.createElement(FolderIcon, { size: 13 }), react.createElement("span", { className: "dgw-changeDirName" }, label), react.createElement("span", { className: "dgw-changeDirCount" }, `${countFiles(node)} 个文件`)));
					if (!open) return;
					for (const child of node.dirs.values()) emitDir(child, depth + 1);
					for (const entry of node.files) emit(entry, depth + 1);
				};
				for (const dir of tree.dirs) emitDir(dir, 0);
				return nodes;
			};
			/** Render one section header (collapsible when asked) plus its rows. */
			const renderSection = (section) => {
				const collapsible = props.collapsibleSections === true;
				const open = !collapsible || collapsedSections[section.title] !== true;
				return react.createElement("div", {
					className: "dgw-changeSection",
					key: section.title
				}, collapsible ? react.createElement("button", {
					className: "dgw-changeHead dgw-changeHead--button",
					type: "button",
					onClick: () => setCollapsedSections((state) => ({
						...state,
						[section.title]: open
					}))
				}, react.createElement("span", {
					className: "dgw-changeChevron",
					"data-open": open ? "true" : "false"
				}, react.createElement(ChevronIcon, { size: 11 })), section.title) : react.createElement("div", { className: "dgw-changeHead" }, section.title), open ? renderRows(section.rows, section.checked, section.discardable) : null);
			};
			return react.createElement("div", { className: "dgw-commit" }, props.groupByDirectory === true && changeFolderPaths.length > 0 ? react.createElement("div", { className: "dgw-changeActions" }, react.createElement("button", {
				className: "dgw-linkBtn",
				type: "button",
				onClick: expandAllDirs
			}, "全部展开"), react.createElement("button", {
				className: "dgw-linkBtn",
				type: "button",
				onClick: collapseAllDirs
			}, "全部收起")) : null, react.createElement("div", { className: "dgw-changeScroll" }, clean ? react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, "没有要提交的内容，工作树是干净的")) : sections.filter((section) => section.rows.length > 0).map((section) => renderSection(section))), react.createElement("div", { className: "dgw-commitForm" }, react.createElement("textarea", {
				className: "dgw-textarea",
				placeholder: "提交信息",
				value: message,
				onChange: (event) => setMessage(event.target.value),
				"aria-label": "提交信息"
			}), error === null ? null : react.createElement("div", { className: "dgw-inlineError" }, describeGitError(error.code, error.message), error.detail === void 0 ? null : `\n${error.detail}`), react.createElement("div", { className: "dgw-formRow" }, react.createElement("label", { className: "dgw-label" }, react.createElement("input", {
				type: "checkbox",
				checked: amend,
				onChange: (event) => setAmend(event.target.checked)
			}), "修正上次提交"), react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				disabled: busy,
				title: "把当前工作区更改放进 git stash（含未跟踪文件）",
				onClick: () => {
					run({
						kind: "stashPush",
						workspaceId,
						includeUntracked: true,
						message: "WIP from Git tool window"
					});
				}
			}, "搁置"), react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				disabled: busy || snapshot.stashCount === 0,
				title: "弹出最近一次搁置",
				onClick: () => {
					run({
						kind: "stashPop",
						workspaceId
					});
				}
			}, "弹出搁置"), react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				disabled: busy || snapshot.stashCount === 0,
				title: "删除最近一次搁置（不会应用内容，需确认）",
				onClick: () => setDropStashPending(true)
			}, "丢弃搁置…"), react.createElement("span", { className: "dgw-spacer" }), react.createElement("span", { className: "dgw-meta" }, `已暂存 ${staged.length}`), react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				disabled: busy || message.trim() === "" || staged.length === 0 || conflicts.length > 0,
				onClick: () => {
					commit(false);
				}
			}, "提交"), react.createElement("button", {
				className: "dgw-btn dgw-btn--primary",
				type: "button",
				disabled: busy || message.trim() === "" || staged.length === 0 || conflicts.length > 0,
				onClick: () => {
					commit(true);
				}
			}, "提交并推送"))), discardRequest === null ? null : react.createElement("div", { className: "dgw-modalBackdrop" }, react.createElement("div", {
				className: "dgw-modal",
				role: "alertdialog",
				"aria-label": "确认丢弃更改"
			}, react.createElement("div", { className: "dgw-modalTitle" }, "确认丢弃更改"), react.createElement("div", { className: "dgw-modalText" }, discardRequest.untracked.length > 0 ? `将永久删除 ${discardRequest.label}，此操作不可撤销。` : `将把 ${discardRequest.label} 恢复到上次提交的内容，此操作不可撤销。`), react.createElement("div", { className: "dgw-modalActions" }, react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				onClick: () => setDiscardRequest(null),
				disabled: busy
			}, "取消"), react.createElement("button", {
				className: "dgw-btn dgw-btn--danger",
				type: "button",
				onClick: () => {
					confirmDiscard();
				},
				disabled: busy
			}, discardRequest.untracked.length > 0 ? "永久删除" : "丢弃更改")))), dropStashPending ? react.createElement("div", { className: "dgw-modalBackdrop" }, react.createElement("div", {
				className: "dgw-modal",
				role: "alertdialog",
				"aria-label": "确认丢弃搁置"
			}, react.createElement("div", { className: "dgw-modalTitle" }, "确认丢弃搁置"), react.createElement("div", { className: "dgw-modalText" }, "将永久删除最近一次搁置（不会应用其中的内容），此操作不可撤销。"), react.createElement("div", { className: "dgw-modalActions" }, react.createElement("button", {
				className: "dgw-btn",
				type: "button",
				onClick: () => setDropStashPending(false),
				disabled: busy
			}, "取消"), react.createElement("button", {
				className: "dgw-btn dgw-btn--danger",
				type: "button",
				onClick: () => {
					confirmDropStash();
				},
				disabled: busy
			}, "删除搁置")))) : null);
		}
		//#endregion
		//#region src/git-workspace/window/console.ts
		/**
		* Console pane: the commands the Host actually executed, newest first.
		* @module dsh-session-map/git-workspace/window/console
		*/
		/** Render the console tab. */
		function ConsolePane(props) {
			if (props.commands.length === 0) return react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, react.createElement("div", null, "还没有执行过 git 命令"), react.createElement("div", null, "刷新、查看日志或打开提交详情后，实际执行的命令会显示在这里。")));
			const rows = [...props.commands].reverse();
			return react.createElement("div", { className: "dgw-console" }, react.createElement("div", { className: "dgw-rows" }, ...rows.map((command, index) => react.createElement("div", {
				className: "dgw-consoleRow",
				key: `${index}-${command.argv.join(" ")}`,
				title: command.argv.join(" ")
			}, react.createElement("span", { className: command.exitCode === 0 ? "dgw-consoleExit" : "dgw-consoleExit dgw-consoleExit--fail" }, command.cancelled === true ? "cancel" : `exit ${String(command.exitCode)}`), react.createElement("span", { className: "dgw-consoleArgv" }, command.argv.join(" ")), command.truncated === true ? react.createElement("span", { className: "dgw-consoleMs" }, "truncated") : null, react.createElement("span", { className: "dgw-consoleMs" }, `${command.ms} ms`)))));
		}
		//#endregion
		//#region src/git-workspace/window/css.ts
		/**
		* Stylesheet for the Git tool window.
		*
		* Every colour is a Harness theme token; the only plugin-local variables are the
		* Git semantic colours (file status and graph lanes), which the product tokens
		* do not cover. The sheet travels as a string because the static browser half
		* has no `styles` service.
		*
		* @module dsh-session-map/git-workspace/window/css
		*/
		const CSS$1 = `
.dgw {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  --dgw-modified: #4d9fec;
  --dgw-added: #73c991;
  --dgw-deleted: #9aa0a6;
  --dgw-conflict: #f14c4c;
  --dgw-untracked: #cbcb41;
  --dgw-addBg: rgba(115, 201, 145, .14);
  --dgw-delBg: rgba(241, 76, 76, .14);
}
.dgw * { box-sizing: border-box; }
.dgw-panelIcon { display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary); }
.dgw-panelIcon--active { color: var(--dsw-alias-brand-primary); }
.dgw-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.dgw-brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dgw-brand > svg { color: var(--dsw-alias-brand-primary); }
.dgw-select {
  height: 26px;
  max-width: 280px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.dgw-spacer { flex: 1 1 auto; }
.dgw-iconBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dgw-iconBtn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dgw-iconBtn:disabled { opacity: .45; cursor: default; }
.dgw-status { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dgw-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.dgw-tab {
  appearance: none;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 0 12px;
  font-size: 13px;
  cursor: pointer;
}
.dgw-tab:hover { color: var(--dsw-alias-label-primary); }
.dgw-tab--active { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.dgw-body { flex: 1 1 auto; min-height: 0; display: flex; }
.dgw-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 10px 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.dgw-errorText { flex: 1 1 auto; white-space: pre-wrap; word-break: break-word; }
.dgw-errorDetail {
  margin: 6px 0 0;
  max-height: 120px;
  overflow: auto;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
}
.dgw-retry { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); border-radius: 4px; font-size: 11px; padding: 2px 8px; cursor: pointer; }
.dgw-logLayout { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.dgw-tree {
  display: flex;
  flex-direction: column;
  width: 260px;
  flex: 0 0 260px;
  min-width: 200px;
  border-right: 1px solid var(--dsw-alias-border-l1);
  min-height: 0;
}
.dgw-treeHead { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dgw-search { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; color: var(--dsw-alias-label-secondary); }
.dgw-searchInput {
  width: 100%;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.dgw-treeScroll { flex: 1 1 auto; overflow: auto; padding: 4px 0 10px; }
/* Compact text actions above a tree (expand/collapse all). */
.dgw-treeActions { display: flex; justify-content: flex-end; gap: 6px; padding: 2px 8px; flex: 0 0 auto; }
.dgw-changeActions { display: flex; justify-content: flex-end; gap: 6px; padding: 4px 10px 0; flex: 0 0 auto; }
.dgw-linkBtn { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; padding: 1px 4px; border-radius: 3px; cursor: pointer; }
.dgw-linkBtn:hover { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }

.dgw-treeSectionHead {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 5px 8px 5px 10px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .02em;
  text-transform: none;
  cursor: pointer;
}
/* Groups read as blocks instead of one flat run of rows. */
.dgw-treeRow + .dgw-treeSectionHead,
.dgw-treeSectionHead + .dgw-treeSectionHead {
  margin-top: 4px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dgw-treeSectionHead:hover { color: var(--dsw-alias-label-primary); }
.dgw-treeSectionHead > svg { transition: transform .12s ease; }
.dgw-treeSectionHead[data-open='true'] > svg { transform: rotate(90deg); }
.dgw-treeRow {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px 0 20px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.dgw-treeRow:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.dgw-treeRow--folder { width: 100%; border: 0; background: transparent; text-align: left; font: inherit; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dgw-treeRow--folder > svg:first-child { transition: transform .12s ease; }
.dgw-treeRow--folder[data-open='true'] > svg:first-child { transform: rotate(90deg); }
/* Current branch gets a light brand wash; the branch-filter selection is
   stronger and keeps its tint even while hovered. */
.dgw-treeRow--current { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent); }
.dgw-treeRow--active,
.dgw-treeRow--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.dgw-treeRow > svg { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dgw-treeRow--current > svg { color: var(--dsw-alias-brand-primary); }
.dgw-treeName { overflow: hidden; text-overflow: ellipsis; }
.dgw-treeRow--current .dgw-treeName { font-weight: 600; }
.dgw-treeBadge { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dgw-list { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; border-right: 1px solid var(--dsw-alias-border-l1); }
.dgw-listHead { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); min-height: 37px; }
.dgw-chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 11px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); color: var(--dsw-alias-brand-primary); font-size: 11px; white-space: nowrap; }
.dgw-rows { flex: 1 1 auto; overflow: auto; min-height: 0; }
.dgw-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px 0 0;
  background: transparent;
  cursor: default;
  white-space: nowrap;
  border-bottom: 1px solid transparent;
}
.dgw-row:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }
.dgw-row--active,
.dgw-row--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
/* IDEA mutes merge commits: their subject uses the secondary text tone so a
   "Merge branch ..." entry does not compete with ordinary commits. */
.dgw-row--merge .dgw-subject { color: var(--dsw-alias-label-secondary); }
.dgw-rowMenu { flex: 0 0 auto; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 1; cursor: pointer; opacity: 0; }
.dgw-row:hover .dgw-rowMenu { opacity: 1; }
.dgw-rowMenu:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dgw-gutter { flex: 0 0 auto; height: 26px; }
.dgw-subject { overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; }
.dgw-pills { display: inline-flex; gap: 4px; flex: 0 1 auto; overflow: hidden; }
.dgw-pill { display: inline-block; max-width: 160px; overflow: hidden; text-overflow: ellipsis; padding: 0 6px; border-radius: 8px; font-size: 10px; line-height: 16px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dgw-pill--tag { color: var(--dsw-alias-state-warn-primary); }
.dgw-meta { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dgw-loadMore { width: 100%; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 6px; cursor: pointer; }
.dgw-loadMore:hover { color: var(--dsw-alias-label-primary); }
.dgw-detail { display: flex; flex-direction: column; flex: 0 0 380px; width: 380px; min-width: 300px; min-height: 0; }
/* The log tab's outer columns own the adjustable width; the panes fill them. */
.dgw-treeCol { display: flex; flex-direction: column; flex: 0 0 auto; min-height: 0; min-width: 0; }
.dgw-treeCol > .dgw-tree { width: 100%; flex: 1 1 auto; min-width: 0; }
.dgw-detailCol { display: flex; flex-direction: column; flex: 0 0 auto; min-height: 0; min-width: 0; }
.dgw-detailCol > .dgw-detail { width: 100%; flex: 1 1 auto; min-width: 0; }
.dgw-splitter { flex: 0 0 5px; width: 5px; cursor: col-resize; background: transparent; }
.dgw-splitter:hover, .dgw-splitter:active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); }
.dgw-detailHead { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); min-height: 37px; }
.dgw-hash { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; color: var(--dsw-alias-label-primary); }
.dgw-detailScroll { flex: 0 0 auto; max-height: 45%; overflow: auto; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dgw-msg { white-space: pre-wrap; word-break: break-word; margin-bottom: 8px; }
.dgw-detailMeta { font-size: 11px; color: var(--dsw-alias-label-secondary); display: flex; flex-direction: column; gap: 3px; }
.dgw-detailRefs { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.dgw-sectionTitle { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 8px 0 4px; }
.dgw-fileRow { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 4px; border-radius: 3px; cursor: pointer; white-space: nowrap; }
.dgw-fileRow:hover { background: var(--dsw-alias-bg-layer-2); }
.dgw-fileRow--active,
.dgw-fileRow--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.dgw-fileRow > svg { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dgw-filePath { overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; }
.dgw-fileStat { flex: 0 0 auto; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dgw-fileStat--add { color: var(--dgw-added); }
.dgw-fileStat--del { color: var(--dgw-conflict); }
.dgw-diff { flex: 1 1 auto; min-height: 0; overflow: auto; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; line-height: 17px; }
.dgw-diffLine { display: flex; white-space: pre; padding-right: 8px; }
.dgw-diffLine--add { background: var(--dgw-addBg); }
.dgw-diffLine--del { background: var(--dgw-delBg); }
.dgw-diffLineNo { flex: 0 0 42px; color: var(--dsw-alias-label-secondary); text-align: right; padding-right: 8px; user-select: none; }
.dgw-diffSign { flex: 0 0 14px; color: var(--dsw-alias-label-secondary); }
.dgw-hunkHead { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); padding: 2px 8px; }
.dgw-empty { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; padding: 24px; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }
.dgw-emptyBox { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: 320px; }
.dgw-loading { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dgw-console { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dgw-consoleRow { display: flex; gap: 8px; padding: 5px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; }
.dgw-consoleExit { flex: 0 0 auto; color: var(--dsw-alias-state-success-primary); }
.dgw-consoleExit--fail { color: var(--dsw-alias-state-error-primary); }
.dgw-consoleArgv { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgw-consoleMs { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dgw-statusBar { display: flex; align-items: center; gap: 12px; height: 24px; padding: 0 10px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; flex: 0 0 auto; }
.dgw-statusBar--warn { color: var(--dsw-alias-state-warn-primary); }
.dgw-commit { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dgw-changeScroll { flex: 1 1 auto; overflow: auto; min-height: 0; padding: 4px 0; }
.dgw-changeSection { padding: 2px 0; }
.dgw-changeHead { display: flex; align-items: center; gap: 6px; padding: 3px 10px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 600; }
.dgw-changeRow { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px 0 8px; cursor: pointer; }
.dgw-changeRow:hover { background: var(--dsw-alias-bg-layer-2); }
/* The right-column page previews on row click: the matching row stays marked. */
.dgw-changeRow--active,
.dgw-changeRow--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
/* One vertical guide per nesting level, so deep paths read as a tree. */
.dgw-changeGuide,
.dgw-treeGuide {
  flex: 0 0 12px;
  width: 12px;
  align-self: stretch;
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.dgw-changeHead--button { width: 100%; border: 0; background: transparent; text-align: left; cursor: pointer; }
.dgw-checkbox { flex: 0 0 14px; width: 14px; height: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; background: var(--dsw-alias-bg-layer-1); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; line-height: 1; color: var(--dsw-alias-bg-base); }
.dgw-checkbox--button { padding: 0; font: inherit; cursor: pointer; }
.dgw-checkbox[data-checked='true'] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
/* Directory rows of the grouped change tree (right-column page). */
.dgw-changeDir { display: flex; align-items: center; gap: 5px; width: 100%; height: 24px; padding: 0 10px 0 8px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; text-align: left; cursor: pointer; white-space: nowrap; }
.dgw-changeDir:hover { background: var(--dsw-alias-bg-layer-2); }
.dgw-changeDirName { flex: 0 1 auto; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.dgw-changeDirCount { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dgw-changeChevron { display: inline-flex; transition: transform .12s ease; }
.dgw-changeChevron[data-open='true'] { transform: rotate(90deg); }
.dgw-changePath { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; }
.dgw-changeStatus { flex: 0 0 auto; font-size: 10px; font-weight: 700; }
.dgw-discard { flex: 0 0 auto; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10px; cursor: pointer; opacity: 0; }
.dgw-changeRow:hover .dgw-discard { opacity: 1; }
.dgw-discard:hover { color: var(--dsw-alias-state-error-primary); }
.dgw-commitForm { flex: 0 0 auto; border-top: 1px solid var(--dsw-alias-border-l1); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.dgw-textarea { min-height: 64px; max-height: 180px; resize: vertical; padding: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
.dgw-formRow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dgw-label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dgw-btn { height: 26px; padding: 0 10px; flex: 0 0 auto; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }
.dgw-btn:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dgw-btn:disabled { opacity: .5; cursor: default; }
.dgw-btn--primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dgw-btn--danger { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-bg-base); }
.dgw-inlineError { color: var(--dsw-alias-state-error-primary); font-size: 11px; white-space: pre-wrap; }
.dgw-modalBackdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 10; }
.dgw-modal { width: 360px; max-width: calc(100% - 32px); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-overlay); padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.dgw-modalTitle { font-weight: 600; }
.dgw-modalText { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }
/* Push preview: IDEA-style two panes, commits on the left, changed files on the right. */
.dgw-pushModal {
  width: min(900px, calc(100vw - 80px));
  height: min(620px, calc(100vh - 120px));
  max-width: none;
  padding: 0;
  gap: 0;
  overflow: hidden;
}
.dgw-pushModal > .dgw-modalTitle { flex: 0 0 auto; padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dgw-pushBody { display: flex; flex: 1 1 auto; min-height: 0; }
.dgw-pushLeft {
  flex: 0 0 280px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--dsw-alias-border-l1);
}
/* The branch row stays pinned; only the commit list scrolls. */
.dgw-pushMapping { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
.dgw-pushBranchToggle { flex: 0 0 auto; display: inline-flex; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dgw-pushBranchToggle svg { transition: transform .12s ease; }
.dgw-pushBranchToggle[data-open='true'] svg { transform: rotate(90deg); }
.dgw-pushMappingText { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgw-pushCommits {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  margin-left: 18px;
  border-left: 1px solid var(--dsw-alias-border-l1);
}
.dgw-pushMapping {
  flex: 0 0 auto;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.dgw-pushMapping:hover { background: var(--dsw-alias-bg-layer-2); }
.dgw-pushMapping--active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.dgw-pushCommit {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 12px 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 12px;
  cursor: pointer;
}
.dgw-pushCommit:hover { background: var(--dsw-alias-bg-layer-1); }
.dgw-pushCommit--active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.dgw-pushRight { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.dgw-pushSectionHead {
  flex: 0 0 auto;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.dgw-pushFiles { flex: 1 1 auto; overflow: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
.dgw-pushFolder, .dgw-pushFile { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.dgw-pushFolder { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dgw-pushFolder > svg, .dgw-pushFile > svg { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dgw-pushFolderName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgw-pushFolder > .dgw-meta { margin-left: auto; }
.dgw-pushSubject, .dgw-pushFilePath { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgw-pushFilePath { font-family: var(--dsw-font-mono, ui-monospace, monospace); }
.dgw-pushFileStatus { flex: 0 0 14px; color: var(--dsw-alias-label-secondary); }
.dgw-pushEmpty { padding: 12px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dgw-pushFooter {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dgw-choice { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dgw-choice input { accent-color: var(--dsw-alias-brand-primary); }
.dgw-modalActions { display: flex; justify-content: flex-end; gap: 8px; }
.dgw-menu { position: fixed; z-index: 20; min-width: 170px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 8px 24px rgba(0,0,0,.35); display: flex; flex-direction: column; }
.dgw-menuItem { border: 0; background: transparent; text-align: left; padding: 5px 10px; border-radius: 4px; color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }
.dgw-menuItem:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }
.dgw-fieldLabel { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dgw-input { height: 26px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; }
/* Side-by-side diff: two code panes that scroll horizontally (linked), and a
   fixed centre gutter with both line numbers. Vertical scrolling is mirrored
   across all three so rows stay aligned; the numbers never move sideways. */
.dgw-diffSide { display: flex; align-items: stretch; height: 100%; min-height: 0; overflow: hidden; }
.dgw-diffSidePane { flex: 1 1 50%; min-width: 0; min-height: 0; overflow-x: scroll; overflow-y: auto; overscroll-behavior: contain; }
/* Both panes keep their own (linked) vertical scrollbar, like IDEA's diff:
   dragging either one moves both, and wheel/trackpad still works. */
.dgw-diffSideGutter {
  flex: 0 0 84px;
  width: 84px;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--dsw-alias-border-l1);
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.dgw-diffGutterTrack { display: flex; flex-direction: column; width: 100%; will-change: transform; }
.dgw-diffSideRow {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  width: max-content;
  min-width: 100%;
  height: 17px;
  line-height: 17px;
  white-space: pre;
  padding: 0 8px;
}
.dgw-diffSideRow--add { background: var(--dgw-addBg); }
.dgw-diffSideRow--del { background: var(--dgw-delBg); }
.dgw-diffSideText { flex: 0 0 auto; }
.dgw-diffSideHunk {
  flex: 0 0 auto;
  width: max-content;
  min-width: 100%;
  height: 20px;
  line-height: 20px;
  padding: 0 8px;
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-1);
}
.dgw-diffSideHunk--blank { color: transparent; }
.dgw-diffGutterRow { display: flex; flex: 0 0 auto; height: 17px; }
.dgw-diffGutterNo {
  flex: 1 1 50%;
  min-width: 0;
  padding-right: 6px;
  text-align: right;
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
}
.dgw-diffGutterNo--add { background: var(--dgw-addBg); }
.dgw-diffGutterNo--del { background: var(--dgw-delBg); }
.dgw-diffGutterHunk { flex: 0 0 auto; height: 20px; background: var(--dsw-alias-bg-layer-1); }
`;
		//#endregion
		//#region src/git-workspace/window/feedback.ts
		/**
		* Shared feedback panes for the two Git carriers: the inline error banner and
		* the "not a repository" empty state. Both were private to the main panel's
		* shell; the right-column page shows the same words, so they live here.
		*
		* @module dsh-session-map/git-workspace/window/feedback
		*/
		/** Render one inline error banner. */
		function ErrorBanner(props) {
			if (props.error === null) return null;
			return react.createElement("div", {
				className: "dgw-error",
				role: "alert"
			}, react.createElement("div", { className: "dgw-errorText" }, describeGitError(props.error.code, props.error.message), props.error.detail === void 0 ? null : react.createElement("pre", { className: "dgw-errorDetail" }, props.error.detail)), react.createElement("button", {
				className: "dgw-retry",
				type: "button",
				onClick: props.onRetry
			}, "重试"));
		}
		/** Render the empty state for a workspace that has no git repository. */
		function NoRepo(props) {
			return react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, react.createElement("div", null, "当前工作区不是 git 仓库"), react.createElement("div", null, "请在工作中选择另一个目录，或先在此目录初始化 git。"), react.createElement("button", {
				className: "dgw-retry",
				type: "button",
				onClick: props.onRetry
			}, "重新检测")));
		}
		//#endregion
		//#region src/git-workspace/window/shell.ts
		/**
		* The Git tool window shell: workspace picker, tabs, polling, selection and the
		* three panes. It is a `main` panel component, so it receives the framework's
		* `useWorkspaces` / `useSessions` hooks as props and has no session of its own.
		*
		* The shell is a factory over a {@link GitWindowApi} so the SSR smoke test can
		* render it with fixtures instead of the network.
		*
		* @module dsh-session-map/git-workspace/window/shell
		*/
		/** Browser-local key remembering the panel is open across reloads. */
		const PANEL_OPEN_KEY = "dsh.git-window.panelOpen";
		/** Browser-local key remembering the last workspace. */
		const WORKSPACE_KEY = "dsh.git-window.workspaceId";
		/** Browser-local key remembering the active tab. */
		const TAB_KEY = "dsh.git-window.tab";
		/** Read one browser-local string. */
		function readStored(key) {
			if (typeof localStorage === "undefined") return null;
			try {
				return localStorage.getItem(key);
			} catch {
				return null;
			}
		}
		/** Write one browser-local string; denial is not an error. */
		function writeStored(key, value) {
			if (typeof localStorage === "undefined") return;
			try {
				localStorage.setItem(key, value);
			} catch {}
		}
		/** Normalize one unknown failure into the API error shape. */
		function toApiError$1(error) {
			if (error instanceof GitApiError) return error;
			return new GitApiError("internal", error instanceof Error ? error.message : String(error));
		}
		/** Stable selector for the Workspace rows. */
		function selectItems(state) {
			return state.items;
		}
		/** Stable selector for the current Session id. */
		function selectCurrent(state) {
			return state.current;
		}
		/** Browser-local key for the log tab's column widths. */
		const LOG_COLUMNS_KEY = "dsh.git-window.logColumns";
		/** Width bounds for the branch tree and the commit-detail column. */
		const TREE_WIDTH_MIN = 180;
		const TREE_WIDTH_MAX = 420;
		const DETAIL_WIDTH_MIN = 260;
		const DETAIL_WIDTH_MAX = 640;
		/** Clamp one column width into its allowed range. */
		function clampWidth(value, min, max) {
			return Math.min(Math.max(min, Math.round(value)), max);
		}
		/** Read the saved column widths, falling back to the historical defaults. */
		function readLogColumns() {
			const fallback = {
				tree: 260,
				detail: 380
			};
			const raw = readStored(LOG_COLUMNS_KEY);
			if (raw === null) return fallback;
			try {
				const parsed = JSON.parse(raw);
				return {
					tree: typeof parsed.tree === "number" ? clampWidth(parsed.tree, TREE_WIDTH_MIN, TREE_WIDTH_MAX) : fallback.tree,
					detail: typeof parsed.detail === "number" ? clampWidth(parsed.detail, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX) : fallback.detail
				};
			} catch {
				return fallback;
			}
		}
		/** Poll interval while the tab is visible and focused. */
		const POLL_VISIBLE_MS$1 = 3e3;
		/** Poll interval after the panel has been hidden for a while. */
		const POLL_HIDDEN_MS$1 = 1e4;
		/** Build the panel component over one runtime. */
		function createGitPanel(runtime) {
			return function GitPanel(props) {
				const useWorkspaces = props.useWorkspaces;
				const useSessions = props.useSessions;
				const items = typeof useWorkspaces === "function" ? useWorkspaces(selectItems) : [];
				const current = typeof useSessions === "function" ? useSessions(selectCurrent) : void 0;
				const [choice, setChoice] = react.useState(() => readStored(WORKSPACE_KEY));
				const [tab, setTab] = react.useState(() => {
					const stored = readStored(TAB_KEY);
					return stored === "console" || stored === "commit" ? stored : "log";
				});
				const [refreshKey, setRefreshKey] = react.useState(0);
				const [snapshot, setSnapshot] = react.useState(null);
				const [snapshotError, setSnapshotError] = react.useState(null);
				const [snapshotLoading, setSnapshotLoading] = react.useState(false);
				const [branchFilter, setBranchFilter] = react.useState(null);
				const [queryInput, setQueryInput] = react.useState("");
				const [query, setQuery] = react.useState("");
				const [log, setLog] = react.useState({
					commits: [],
					hasMore: false
				});
				const [logLoading, setLogLoading] = react.useState(false);
				const [logLoadingMore, setLogLoadingMore] = react.useState(false);
				const [logError, setLogError] = react.useState(null);
				const [selectedHash, setSelectedHash] = react.useState(null);
				const [detail, setDetail] = react.useState(null);
				const [detailLoading, setDetailLoading] = react.useState(false);
				const [detailError, setDetailError] = react.useState(null);
				const [selectedFile, setSelectedFile] = react.useState(null);
				const [diff, setDiff] = react.useState(null);
				const [diffLoading, setDiffLoading] = react.useState(false);
				const [diffError, setDiffError] = react.useState(null);
				const [commands, setCommands] = react.useState([]);
				const [actionError, setActionError] = react.useState(null);
				const [branchPrompt, setBranchPrompt] = react.useState(null);
				const [branchValue, setBranchValue] = react.useState("");
				const [branchForce, setBranchForce] = react.useState(false);
				const [branchBusy, setBranchBusy] = react.useState(false);
				const [branchError, setBranchError] = react.useState(null);
				const [job, setJob] = react.useState(null);
				const [jobBusy, setJobBusy] = react.useState(false);
				const [resetTarget, setResetTarget] = react.useState(null);
				const [resetMode, setResetMode] = react.useState("mixed");
				const [resetBusy, setResetBusy] = react.useState(false);
				const [resetError, setResetError] = react.useState(null);
				const [tagTarget, setTagTarget] = react.useState(null);
				const [tagName, setTagName] = react.useState("");
				const [tagBusy, setTagBusy] = react.useState(false);
				const [tagError, setTagError] = react.useState(null);
				const [tagDeleteTarget, setTagDeleteTarget] = react.useState(null);
				const [tagDeleteBusy, setTagDeleteBusy] = react.useState(false);
				const [tagDeleteError, setTagDeleteError] = react.useState(null);
				const [forcePushTarget, setForcePushTarget] = react.useState(null);
				const [forcePushBusy, setForcePushBusy] = react.useState(false);
				const [forcePushError, setForcePushError] = react.useState(null);
				const [updateDialog, setUpdateDialog] = react.useState(null);
				const [pushOpen, setPushOpen] = react.useState(false);
				const [pushPreview, setPushPreview] = react.useState(null);
				const [pushPreviewLoading, setPushPreviewLoading] = react.useState(false);
				const [pushPreviewError, setPushPreviewError] = react.useState(null);
				const [pushForce, setPushForce] = react.useState(false);
				const [logColumns, setLogColumns] = react.useState(() => readLogColumns());
				const logColumnsRef = react.useRef(logColumns);
				logColumnsRef.current = logColumns;
				const columnDrag = react.useRef(null);
				react.useEffect(() => {
					const move = (event) => {
						const drag = columnDrag.current;
						if (drag === null) return;
						const delta = event.clientX - drag.startX;
						setLogColumns((previous) => drag.kind === "tree" ? {
							...previous,
							tree: clampWidth(drag.base + delta, TREE_WIDTH_MIN, TREE_WIDTH_MAX)
						} : {
							...previous,
							detail: clampWidth(drag.base - delta, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX)
						});
					};
					const up = () => {
						if (columnDrag.current === null) return;
						columnDrag.current = null;
						document.body.style.userSelect = "";
						writeStored(LOG_COLUMNS_KEY, JSON.stringify(logColumnsRef.current));
					};
					window.addEventListener("pointermove", move);
					window.addEventListener("pointerup", up);
					return () => {
						window.removeEventListener("pointermove", move);
						window.removeEventListener("pointerup", up);
						document.body.style.userSelect = "";
					};
				}, []);
				const startColumnDrag = (kind, event) => {
					event.preventDefault();
					document.body.style.userSelect = "none";
					columnDrag.current = {
						kind,
						startX: event.clientX,
						base: kind === "tree" ? logColumns.tree : logColumns.detail
					};
				};
				const remembered = readStored(WORKSPACE_KEY);
				const workspaceId = (items.find((item) => item.workspaceId === choice) ?? items.find((item) => item.workspaceId === remembered) ?? items.find((item) => current !== void 0 && item.sessionIds.includes(current)) ?? items[0])?.workspaceId ?? null;
				const upstreamRef = snapshot?.head.upstream?.ref ?? null;
				const upstreamOid = upstreamRef === null ? null : snapshot?.branches.find((branch) => branch.type === "remote" && (branch.ref === upstreamRef || branch.name === upstreamRef || upstreamRef.endsWith("/" + branch.name)))?.oid ?? null;
				const appendCommands = react.useCallback((incoming) => {
					if (incoming.length === 0) return;
					setCommands((previous) => [...previous, ...incoming].slice(-300));
				}, []);
				const retry = react.useCallback(() => {
					setSnapshotError(null);
					setLogError(null);
					setDetailError(null);
					setDiffError(null);
					setActionError(null);
					setBranchError(null);
					setRefreshKey((key) => key + 1);
				}, []);
				/** Check out one local branch and refresh both history views. */
				const checkoutBranch = async (ref) => {
					if (workspaceId === null || branchBusy) return;
					setBranchBusy(true);
					setActionError(null);
					try {
						await runtime.action({
							kind: "checkout",
							workspaceId,
							ref
						});
						setBranchFilter(null);
						setSelectedHash(null);
						setRefreshKey((key) => key + 1);
					} catch (error) {
						setActionError(toApiError$1(error));
					} finally {
						setBranchBusy(false);
					}
				};
				const openBranchDialog = (prompt, initial) => {
					setBranchPrompt(prompt);
					setBranchValue(initial);
					setBranchForce(false);
					setBranchError(null);
				};
				/** Run the dialog's create/rename/delete round-trip. */
				const submitBranchDialog = async () => {
					if (workspaceId === null || branchPrompt === null || branchBusy) return;
					const name = branchValue.trim();
					if (branchPrompt.kind !== "delete" && name === "") return;
					setBranchBusy(true);
					setBranchError(null);
					try {
						if (branchPrompt.kind === "create") await runtime.action({
							kind: "createBranch",
							workspaceId,
							name,
							...branchPrompt.start === void 0 ? {} : { start: branchPrompt.start }
						});
						else if (branchPrompt.kind === "rename") await runtime.action({
							kind: "renameBranch",
							workspaceId,
							from: branchPrompt.branch ?? "",
							to: name
						});
						else {
							const action = {
								kind: "deleteBranch",
								workspaceId,
								name: branchPrompt.branch ?? "",
								force: branchForce
							};
							const confirmation = await runtime.confirm(action);
							await runtime.action(action, confirmation.token);
						}
						setBranchPrompt(null);
						setBranchFilter(null);
						setSelectedHash(null);
						setRefreshKey((key) => key + 1);
					} catch (error) {
						setBranchError(toApiError$1(error));
					} finally {
						setBranchBusy(false);
					}
				};
				/** Chinese label for one job kind. */
				const jobLabel = (kind) => {
					switch (kind) {
						case "fetch": return "下载远端状态";
						case "update": return "更新当前分支";
						case "push": return "推送";
						default: return kind;
					}
				};
				/** Follow one job through SSE, falling back to polling when the stream fails. */
				const watchJob = (id) => {
					let stopped = false;
					let source;
					const finish = (view) => {
						if (stopped) return;
						setJob(view);
						if (view.status === "running") return;
						stopped = true;
						source?.close();
						setJobBusy(false);
						if (view.status === "failed" && view.error !== void 0) setActionError(new GitApiError(view.error.code, view.error.message, view.error.detail));
						setRefreshKey((key) => key + 1);
					};
					const poll = async () => {
						if (stopped) return;
						try {
							const view = await runtime.job(id);
							finish(view);
							if (!stopped) setTimeout(() => {
								poll();
							}, 700);
						} catch (error) {
							if (stopped) return;
							setActionError(toApiError$1(error));
							setJobBusy(false);
						}
					};
					if (typeof EventSource === "undefined") {
						poll();
						return;
					}
					source = new EventSource(`/plugin-git-workspace/events?job=${encodeURIComponent(id)}`);
					source.onmessage = (event) => {
						try {
							finish(JSON.parse(String(event.data)));
						} catch {}
					};
					source.onerror = () => {
						source?.close();
						source = void 0;
						poll();
					};
				};
				/** Start one long action and follow its job. */
				const runJob = async (action, confirmToken) => {
					if (workspaceId === null || jobBusy) return;
					setJobBusy(true);
					setActionError(null);
					try {
						const result = await runtime.action(action, confirmToken);
						if (result.job === void 0) {
							setJobBusy(false);
							setRefreshKey((key) => key + 1);
							return;
						}
						watchJob(result.job.id);
					} catch (error) {
						setActionError(toApiError$1(error));
						setJobBusy(false);
					}
				};
				/** Push the current branch, defining its upstream on first use. */
				const pushCurrent = () => {
					if (workspaceId === null || snapshot === null) return;
					const branch = snapshot.head.branch;
					if (branch === null) {
						setActionError(new GitApiError("detached-head", "HEAD is detached"));
						return;
					}
					const remote = snapshot.remotes[0]?.name;
					const needsUpstream = snapshot.head.upstream === null;
					if (needsUpstream && remote === void 0) {
						setActionError(new GitApiError("no-upstream", "no remote is configured"));
						return;
					}
					runJob({
						kind: "push",
						workspaceId,
						...needsUpstream && remote !== void 0 ? {
							remote,
							branch,
							setUpstream: true
						} : {}
					});
				};
				/** Force-push the current branch after the server issues an L3 token. */
				const pushForceCurrent = async () => {
					if (workspaceId === null || snapshot === null) return;
					const branch = snapshot.head.branch;
					if (branch === null) {
						setActionError(new GitApiError("detached-head", "HEAD is detached"));
						return;
					}
					const remote = snapshot.remotes[0]?.name;
					const action = {
						kind: "push",
						workspaceId,
						branch,
						forceWithLease: true,
						...remote === void 0 ? {} : { remote }
					};
					try {
						const confirmation = await runtime.confirm(action);
						await runJob(action, confirmation.token);
					} catch (error) {
						setActionError(toApiError$1(error));
					}
				};
				/** Load the push preview, then show the dialog. */
				const openPushPreview = async () => {
					if (workspaceId === null) return;
					setPushOpen(true);
					setPushPreviewLoading(true);
					setPushPreview(null);
					setPushPreviewError(null);
					setPushForce(false);
					try {
						const result = await runtime.pushPreview(workspaceId);
						setPushPreview(result.preview);
					} catch (error) {
						setPushPreviewError(toApiError$1(error).message);
					} finally {
						setPushPreviewLoading(false);
					}
				};
				/** Run one write action that needs no dialog and refresh the views. */
				const runSimple = async (action) => {
					if (workspaceId === null) return;
					setActionError(null);
					try {
						await runtime.action(action);
						setSelectedHash(null);
						setRefreshKey((key) => key + 1);
					} catch (error) {
						setActionError(toApiError$1(error));
					}
				};
				/** Abort the merge/rebase/cherry-pick/revert currently in progress. */
				const abortOperation = () => {
					if (workspaceId === null || snapshot === null) return;
					const operation = snapshot.head.operation;
					if (operation === "none" || operation === "bisect") return;
					runSimple({
						kind: "abortOperation",
						workspaceId,
						operation: operation === "rebase-apply" ? "rebase" : operation
					});
				};
				/** Continue the merge/rebase/cherry-pick/revert after conflicts were resolved. */
				const continueOperation = () => {
					if (workspaceId === null || snapshot === null) return;
					const operation = snapshot.head.operation;
					if (operation === "none" || operation === "bisect") return;
					runSimple({
						kind: "continueOperation",
						workspaceId,
						operation: operation === "rebase-apply" ? "rebase" : operation
					});
				};
				/** Confirm and run a reset to the selected commit. */
				const confirmReset = async () => {
					if (workspaceId === null || resetTarget === null || resetBusy) return;
					setResetBusy(true);
					setResetError(null);
					try {
						const action = {
							kind: "reset",
							workspaceId,
							hash: resetTarget,
							mode: resetMode
						};
						const confirmation = await runtime.confirm(action);
						await runtime.action(action, confirmation.token);
						setResetTarget(null);
						setSelectedHash(null);
						setRefreshKey((key) => key + 1);
					} catch (error) {
						setResetError(toApiError$1(error));
					} finally {
						setResetBusy(false);
					}
				};
				/** Create a lightweight tag on the selected commit. */
				const confirmTag = async () => {
					if (workspaceId === null || tagTarget === null || tagBusy) return;
					const name = tagName.trim();
					if (name === "") return;
					setTagBusy(true);
					setTagError(null);
					try {
						await runtime.action({
							kind: "tagCreate",
							workspaceId,
							name,
							hash: tagTarget
						});
						setTagTarget(null);
						setTagName("");
						setRefreshKey((key) => key + 1);
					} catch (error) {
						setTagError(toApiError$1(error));
					} finally {
						setTagBusy(false);
					}
				};
				/** Delete a tag after the server-issued confirmation. */
				const confirmTagDelete = async () => {
					if (workspaceId === null || tagDeleteTarget === null || tagDeleteBusy) return;
					setTagDeleteBusy(true);
					setTagDeleteError(null);
					try {
						const action = {
							kind: "tagDelete",
							workspaceId,
							name: tagDeleteTarget
						};
						const confirmation = await runtime.confirm(action);
						await runtime.action(action, confirmation.token);
						setTagDeleteTarget(null);
						setRefreshKey((key) => key + 1);
					} catch (error) {
						setTagDeleteError(toApiError$1(error));
					} finally {
						setTagDeleteBusy(false);
					}
				};
				/** Confirm and run a forced push (--force-with-lease). */
				const confirmForcePush = async () => {
					if (workspaceId === null || forcePushTarget === null || forcePushBusy) return;
					setForcePushBusy(true);
					setForcePushError(null);
					try {
						const remote = snapshot?.remotes[0]?.name;
						const action = {
							kind: "push",
							workspaceId,
							branch: forcePushTarget,
							forceWithLease: true,
							...remote === void 0 ? {} : { remote }
						};
						const confirmation = await runtime.confirm(action);
						setForcePushTarget(null);
						await runJob(action, confirmation.token);
					} catch (error) {
						setForcePushError(toApiError$1(error));
					} finally {
						setForcePushBusy(false);
					}
				};
				/** Show the merge/rebase choice, preselected with the last used mode. */
				const openUpdate = () => {
					if (workspaceId === null) return;
					setUpdateDialog({ mode: readUpdateMode() });
				};
				const confirmUpdate = () => {
					if (updateDialog === null || workspaceId === null) return;
					const mode = updateDialog.mode;
					writeUpdateMode(mode);
					setUpdateDialog(null);
					runJob({
						kind: "update",
						workspaceId,
						mode
					});
				};
				react.useEffect(() => {
					writeStored(PANEL_OPEN_KEY, "true");
					return () => {
						writeStored(PANEL_OPEN_KEY, "false");
					};
				}, []);
				react.useEffect(() => {
					writeStored(TAB_KEY, tab);
				}, [tab]);
				react.useEffect(() => {
					if (workspaceId === null) {
						setSnapshot(null);
						setSnapshotLoading(false);
						return;
					}
					let stopped = false;
					const controller = new AbortController();
					let timer;
					setSnapshotLoading(true);
					const tick = async () => {
						try {
							const result = await runtime.snapshot(workspaceId, controller.signal);
							if (stopped) return;
							setSnapshot(result.snapshot);
							setSnapshotError(null);
							appendCommands(result.commands);
						} catch (error) {
							if (stopped || isAbortError$1(error)) return;
							setSnapshotError(toApiError$1(error));
						} finally {
							if (stopped) return;
							setSnapshotLoading(false);
							timer = setTimeout(tick, document.visibilityState === "hidden" ? POLL_HIDDEN_MS$1 : POLL_VISIBLE_MS$1);
						}
					};
					tick();
					const onVisibility = () => {
						if (document.visibilityState !== "visible") return;
						if (timer !== void 0) clearTimeout(timer);
						tick();
					};
					document.addEventListener("visibilitychange", onVisibility);
					return () => {
						stopped = true;
						controller.abort();
						if (timer !== void 0) clearTimeout(timer);
						document.removeEventListener("visibilitychange", onVisibility);
					};
				}, [
					workspaceId,
					refreshKey,
					appendCommands
				]);
				react.useEffect(() => {
					const timer = setTimeout(() => setQuery(queryInput.trim()), 300);
					return () => clearTimeout(timer);
				}, [queryInput]);
				react.useEffect(() => {
					if (workspaceId === null) {
						setLog({
							commits: [],
							hasMore: false
						});
						return;
					}
					let stopped = false;
					const controller = new AbortController();
					setLogLoading(true);
					setSelectedHash(null);
					setDetail(null);
					setSelectedFile(null);
					setDiff(null);
					const request = {
						workspaceId,
						limit: 50,
						...branchFilter === null ? {} : { ref: branchFilter },
						...query === "" ? {} : { query }
					};
					runtime.log(request, controller.signal).then((page) => {
						if (stopped) return;
						setLog({
							commits: page.commits,
							hasMore: page.hasMore
						});
						setLogError(null);
						appendCommands(page.commands);
					}).catch((error) => {
						if (stopped || isAbortError$1(error)) return;
						setLogError(toApiError$1(error));
					}).finally(() => {
						if (!stopped) setLogLoading(false);
					});
					return () => {
						stopped = true;
						controller.abort();
					};
				}, [
					workspaceId,
					branchFilter,
					query,
					refreshKey,
					appendCommands
				]);
				react.useEffect(() => {
					setSelectedFile(null);
					setDiff(null);
					if (workspaceId === null || selectedHash === null) {
						setDetail(null);
						return;
					}
					let stopped = false;
					const controller = new AbortController();
					setDetailLoading(true);
					runtime.commit(workspaceId, selectedHash, controller.signal).then((result) => {
						if (stopped) return;
						setDetail(result.commit);
						setDetailError(null);
						appendCommands(result.commands);
						const first = result.commit.files[0];
						if (first !== void 0) setSelectedFile(first.path);
					}).catch((error) => {
						if (stopped || isAbortError$1(error)) return;
						setDetailError(toApiError$1(error));
					}).finally(() => {
						if (!stopped) setDetailLoading(false);
					});
					return () => {
						stopped = true;
						controller.abort();
					};
				}, [
					workspaceId,
					selectedHash,
					appendCommands
				]);
				react.useEffect(() => {
					if (workspaceId === null || selectedHash === null || selectedFile === null) {
						setDiff(null);
						return;
					}
					let stopped = false;
					const controller = new AbortController();
					setDiffLoading(true);
					runtime.diff({
						workspaceId,
						hash: selectedHash,
						file: selectedFile,
						context: 3
					}, controller.signal).then((result) => {
						if (stopped) return;
						setDiff(parseUnifiedDiff(result.patch, selectedFile, result.truncated));
						setDiffError(null);
						appendCommands(result.commands);
					}).catch((error) => {
						if (stopped || isAbortError$1(error)) return;
						setDiffError(toApiError$1(error));
					}).finally(() => {
						if (!stopped) setDiffLoading(false);
					});
					return () => {
						stopped = true;
						controller.abort();
					};
				}, [
					workspaceId,
					selectedHash,
					selectedFile,
					appendCommands
				]);
				const loadMore = () => {
					if (workspaceId === null || logLoadingMore) return;
					const controller = new AbortController();
					setLogLoadingMore(true);
					runtime.log({
						workspaceId,
						limit: 50,
						skip: log.commits.length,
						...branchFilter === null ? {} : { ref: branchFilter },
						...query === "" ? {} : { query }
					}, controller.signal).then((page) => {
						setLog((previous) => ({
							commits: [...previous.commits, ...page.commits],
							hasMore: page.hasMore
						}));
						appendCommands(page.commands);
					}).catch((error) => {
						if (!isAbortError$1(error)) setLogError(toApiError$1(error));
					}).finally(() => {
						setLogLoadingMore(false);
					});
				};
				const selectWorkspace = (next) => {
					setChoice(next);
					writeStored(WORKSPACE_KEY, next);
					setSnapshot(null);
					setBranchFilter(null);
					setSelectedHash(null);
					setDetail(null);
					setDiff(null);
				};
				const selectBranch = (ref) => {
					setBranchFilter(ref);
				};
				const graph = react.useMemo(() => computeGraph(log.commits), [log.commits]);
				const banner = [
					snapshotError,
					logError,
					detailError,
					diffError,
					actionError
				].filter((error) => error !== null)[0] ?? null;
				const head = snapshot?.head ?? null;
				const branches = snapshot?.branches ?? [];
				const isNoRepo = snapshotError?.code === "not-a-repository";
				const status = snapshot === null ? null : [
					head?.branch ?? (head?.detached === true ? "HEAD 已分离" : "HEAD"),
					head?.upstream === null || head?.upstream === void 0 ? null : `↑${head.upstream.ahead} ↓${head.upstream.behind}`,
					snapshot.counts.staged + snapshot.counts.unstaged + snapshot.counts.untracked + snapshot.counts.conflicted > 0 ? `本地更改 ${snapshot.counts.staged + snapshot.counts.unstaged + snapshot.counts.untracked + snapshot.counts.conflicted}` : "工作树干净"
				].filter((part) => part !== null).join("  ·  ");
				return react.createElement("div", { className: "dgw" }, react.createElement("style", null, CSS$1), react.createElement("div", { className: "dgw-head" }, react.createElement("span", { className: "dgw-brand" }, react.createElement(GitPanelIcon, {
					size: 16,
					active: true
				}), react.createElement("span", null, "Git")), items.length === 0 ? null : react.createElement("select", {
					className: "dgw-select",
					value: workspaceId ?? "",
					onChange: (event) => selectWorkspace(event.target.value),
					"aria-label": "选择工作区"
				}, ...items.map((item) => react.createElement("option", {
					key: item.workspaceId,
					value: item.workspaceId
				}, item.title || item.path))), react.createElement("span", { className: "dgw-spacer" }), status === null ? null : react.createElement("span", { className: "dgw-status" }, status), react.createElement("button", {
					className: "dgw-iconBtn",
					type: "button",
					title: "刷新",
					"aria-label": "刷新",
					onClick: retry,
					disabled: workspaceId === null || snapshotLoading
				}, react.createElement(RefreshIcon, { size: 14 })), react.createElement("button", {
					className: "dgw-iconBtn",
					type: "button",
					title: "下载远端状态（fetch）：只更新远端跟踪分支，不修改工作区或本地分支",
					"aria-label": "下载远端状态",
					disabled: workspaceId === null || jobBusy,
					onClick: () => {
						if (workspaceId !== null) runJob({
							kind: "fetch",
							workspaceId,
							all: true
						});
					}
				}, react.createElement(FetchIcon, { size: 14 })), react.createElement("button", {
					className: "dgw-iconBtn",
					type: "button",
					title: "更新当前分支：先下载远端状态，再按弹窗选择合并或变基",
					"aria-label": "更新当前分支",
					disabled: workspaceId === null || jobBusy || snapshot === null,
					onClick: openUpdate
				}, react.createElement(RefreshIcon, { size: 14 })), react.createElement("button", {
					className: "dgw-iconBtn",
					type: "button",
					title: "推送（push）",
					"aria-label": "推送",
					disabled: workspaceId === null || jobBusy || snapshot === null,
					onClick: () => {
						openPushPreview();
					}
				}, react.createElement(PushIcon, { size: 14 }))), react.createElement("div", {
					className: "dgw-tabs",
					role: "tablist"
				}, react.createElement("button", {
					className: tab === "commit" ? "dgw-tab dgw-tab--active" : "dgw-tab",
					type: "button",
					role: "tab",
					"aria-selected": tab === "commit",
					onClick: () => setTab("commit")
				}, "提交"), react.createElement("button", {
					className: tab === "log" ? "dgw-tab dgw-tab--active" : "dgw-tab",
					type: "button",
					role: "tab",
					"aria-selected": tab === "log",
					onClick: () => setTab("log")
				}, "日志"), react.createElement("button", {
					className: tab === "console" ? "dgw-tab dgw-tab--active" : "dgw-tab",
					type: "button",
					role: "tab",
					"aria-selected": tab === "console",
					onClick: () => setTab("console")
				}, "控制台")), react.createElement(ErrorBanner, {
					error: banner,
					onRetry: retry
				}), workspaceId === null ? react.createElement("div", { className: "dgw-empty" }, react.createElement("div", { className: "dgw-emptyBox" }, react.createElement("div", null, "选择工作区以查看 Git 状态"))) : isNoRepo ? react.createElement(NoRepo, { onRetry: retry }) : react.createElement("div", { className: "dgw-body" }, tab === "commit" ? snapshot === null ? react.createElement("div", { className: "dgw-loading" }, "正在读取仓库状态…") : react.createElement(CommitPane, {
					runtime,
					workspaceId,
					snapshot,
					onChanged: () => setRefreshKey((key) => key + 1)
				}) : tab === "console" ? react.createElement(ConsolePane, { commands }) : react.createElement("div", { className: "dgw-logLayout" }, react.createElement("div", {
					className: "dgw-treeCol",
					style: {
						width: logColumns.tree,
						flexBasis: logColumns.tree
					}
				}, react.createElement(BranchTree, {
					head: head ?? {
						oid: null,
						branch: null,
						detached: false,
						unborn: false,
						upstream: null,
						operation: "none"
					},
					branches,
					selectedRef: branchFilter,
					onSelect: selectBranch,
					onCheckout: (ref) => {
						checkoutBranch(ref);
					},
					onCreateBranch: (start) => openBranchDialog({
						kind: "create",
						...start === void 0 ? {} : { start }
					}, ""),
					onRenameBranch: (name) => openBranchDialog({
						kind: "rename",
						branch: name
					}, name),
					onDeleteBranch: (name) => openBranchDialog({
						kind: "delete",
						branch: name
					}, ""),
					onMergeBranch: (ref) => {
						if (workspaceId !== null) runSimple({
							kind: "merge",
							workspaceId,
							ref
						});
					},
					onRebaseBranch: (ref) => {
						if (workspaceId !== null) runSimple({
							kind: "rebase",
							workspaceId,
							onto: ref
						});
					},
					onDeleteTag: (name) => {
						setTagDeleteTarget(name);
						setTagDeleteError(null);
					},
					onForcePush: (name) => {
						setForcePushTarget(name);
						setForcePushError(null);
					}
				})), react.createElement("div", {
					className: "dgw-splitter",
					role: "separator",
					"aria-orientation": "vertical",
					title: "拖动调整分支树宽度",
					onPointerDown: (event) => startColumnDrag("tree", event)
				}), react.createElement(LogList, {
					commits: log.commits,
					graph,
					selectedOid: selectedHash,
					branchLabel: branchFilter,
					query: queryInput,
					loading: logLoading,
					hasMore: log.hasMore,
					onSelect: (oid) => setSelectedHash(oid),
					onQueryChange: setQueryInput,
					onClearBranch: () => setBranchFilter(null),
					onLoadMore: loadMore,
					onCherryPick: (oid) => {
						if (workspaceId !== null) runSimple({
							kind: "cherryPick",
							workspaceId,
							hash: oid
						});
					},
					onRevert: (oid) => {
						if (workspaceId !== null) runSimple({
							kind: "revert",
							workspaceId,
							hash: oid
						});
					},
					onReset: (oid) => {
						setResetTarget(oid);
						setResetMode("mixed");
						setResetError(null);
					},
					onTagCreate: (oid) => {
						setTagTarget(oid);
						setTagName("");
						setTagError(null);
					}
				}), react.createElement("div", {
					className: "dgw-splitter",
					role: "separator",
					"aria-orientation": "vertical",
					title: "拖动调整提交详情宽度",
					onPointerDown: (event) => startColumnDrag("detail", event)
				}), react.createElement("div", {
					className: "dgw-detailCol",
					style: {
						width: logColumns.detail,
						flexBasis: logColumns.detail
					}
				}, react.createElement(DetailPane, {
					detail,
					loading: detailLoading,
					selectedFile,
					diff,
					diffLoading,
					onSelectFile: setSelectedFile
				})))), snapshot === null ? null : react.createElement("div", { className: snapshot.stale ? "dgw-statusBar dgw-statusBar--warn" : "dgw-statusBar" }, react.createElement("span", null, snapshot.repo.root), snapshot.head.operation !== "none" ? react.createElement(react.Fragment, null, react.createElement("span", null, `正在${snapshot.head.operation}…`), react.createElement("button", {
					className: "dgw-retry",
					type: "button",
					onClick: continueOperation
				}, "继续"), react.createElement("button", {
					className: "dgw-retry",
					type: "button",
					onClick: abortOperation
				}, "中止操作")) : null, react.createElement("span", null, `分支 ${branches.filter((branch) => branch.type === "local").length} · 远程 ${branches.filter((branch) => branch.type === "remote").length}`), job === null ? null : react.createElement("span", { className: "dgw-job" }, `${jobLabel(job.kind)}${job.status === "running" ? "：进行中" : job.status === "done" ? "：完成" : job.status === "cancelled" ? "：已取消" : "：失败"}`, job.status === "running" && job.lines.length > 0 ? `  ${job.lines[job.lines.length - 1] ?? ""}` : ""), job !== null && job.status === "running" ? react.createElement("button", {
					className: "dgw-retry",
					type: "button",
					onClick: () => {
						runtime.cancelJob(job.id).catch((error) => setActionError(toApiError$1(error)));
					}
				}, "取消") : null, react.createElement("span", null, snapshot.truncated ? "结果已截断" : `更新于 ${formatWhen(new Date(snapshot.takenAt).toISOString())}`)), branchPrompt === null ? null : react.createElement(BranchDialog, {
					prompt: branchPrompt,
					value: branchValue,
					force: branchForce,
					busy: branchBusy,
					error: branchError,
					onValue: setBranchValue,
					onForce: setBranchForce,
					onCancel: () => {
						if (!branchBusy) setBranchPrompt(null);
					},
					onConfirm: () => {
						submitBranchDialog();
					}
				}), resetTarget === null ? null : react.createElement(ResetDialog, {
					hash: resetTarget,
					mode: resetMode,
					busy: resetBusy,
					error: resetError,
					onMode: setResetMode,
					onCancel: () => {
						if (!resetBusy) setResetTarget(null);
					},
					onConfirm: () => {
						confirmReset();
					}
				}), tagTarget === null ? null : react.createElement(TagDialog, {
					hash: tagTarget,
					value: tagName,
					busy: tagBusy,
					error: tagError,
					onValue: setTagName,
					onCancel: () => {
						if (!tagBusy) setTagTarget(null);
					},
					onConfirm: () => {
						confirmTag();
					}
				}), tagDeleteTarget === null ? null : react.createElement(TagDeleteDialog, {
					name: tagDeleteTarget,
					busy: tagDeleteBusy,
					error: tagDeleteError,
					onCancel: () => {
						if (!tagDeleteBusy) setTagDeleteTarget(null);
					},
					onConfirm: () => {
						confirmTagDelete();
					}
				}), forcePushTarget === null ? null : react.createElement(ForcePushDialog, {
					branch: forcePushTarget,
					busy: forcePushBusy,
					error: forcePushError,
					onCancel: () => {
						if (!forcePushBusy) setForcePushTarget(null);
					},
					onConfirm: () => {
						confirmForcePush();
					}
				}), updateDialog === null ? null : react.createElement(UpdateDialog, {
					mode: updateDialog.mode,
					busy: jobBusy,
					canReset: upstreamOid !== null,
					onMode: (mode) => setUpdateDialog({ mode }),
					onReset: () => {
						if (upstreamOid === null) return;
						setUpdateDialog(null);
						setResetTarget(upstreamOid);
						setResetMode("hard");
						setResetError(null);
					},
					onCancel: () => setUpdateDialog(null),
					onConfirm: confirmUpdate
				}), pushOpen ? react.createElement(PushDialog, {
					branch: snapshot?.head.branch ?? "",
					remote: snapshot?.remotes[0]?.name ?? null,
					upstream: snapshot?.head.upstream?.ref ?? null,
					preview: pushPreview,
					loading: pushPreviewLoading,
					error: pushPreviewError,
					busy: jobBusy,
					canForce: snapshot?.head.upstream !== null,
					force: pushForce,
					onForce: setPushForce,
					loadCommit: async (oid) => {
						if (workspaceId === null) throw new Error("no workspace");
						return (await runtime.commit(workspaceId, oid)).commit;
					},
					onPush: () => {
						setPushOpen(false);
						if (pushForce) pushForceCurrent();
						else pushCurrent();
					},
					onCancel: () => {
						if (!jobBusy) setPushOpen(false);
					}
				}) : null);
			};
		}
		//#endregion
		//#region src/session-map/sidebar-right.ts
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
		function lookup$1(ctx, name) {
			return ctx.get(name);
		}
		/**
		* Build the effect body that claims one tab type.
		*
		* A page kept open across a host restart still runs the previous incarnation of
		* this plugin, which already holds the same type. Reusing that one is safe: the
		* bodies are re-registered separately under later priorities, so the new bodies
		* win. A DIFFERENT type holding the kind is a real wiring conflict and still
		* fails loud.
		* @param tabs - the native tab-type registry.
		* @returns a claim function; call it inside an effect to own the registration.
		*/
		function createTypeClaimer(tabs) {
			return (id, kind, title, guideTitle, guideDescription) => {
				return () => {
					const existing = tabs.get(kind);
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
					return tabs.register(definition);
				};
			};
		}
		//#endregion
		//#region src/git-workspace/window/rightbar/ids.ts
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
		const GIT_RIGHTBAR_KIND = "git-window";
		/** Tab-type id the page body registers under. */
		const GIT_RIGHTBAR_TYPE_ID = "dsh-session-map.git";
		/** Session-header launcher id. */
		const GIT_RIGHTBAR_HEADER_ID = "git-window-launcher";
		//#endregion
		//#region src/git-workspace/window/rightbar/css.ts
		/**
		* Layout stylesheet of the Git right-column page.
		*
		* It is concatenated after the shared `CSS` string (which owns the `--dgw-*`
		* semantic colours and the `.dgw-*` component classes), so this file only adds
		* the page's own boxes. Every value rides a Harness theme token.
		*
		* @module dsh-session-map/git-workspace/window/rightbar/css
		*/
		const RIGHTBAR_CSS = `
.dgw-rb { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dgw-rb__top {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  flex: 0 0 auto;
  padding: 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.dgw-rb__chip {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.dgw-rb__repo {
  min-width: 0;
  max-width: 180px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dgw-rb__main { display: flex; flex: 1 1 auto; min-height: 0; }
.dgw-rb__commitCol {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-width: 280px;
  min-height: 0;
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dgw-rb__commitCol > .dgw-commit { flex: 1 1 auto; min-height: 0; }
.dgw-rb__vsplit {
  flex: 0 0 6px;
  width: 6px;
  cursor: col-resize;
  border-left: 1px solid var(--dsw-alias-border-l1);
  border-right: 1px solid var(--dsw-alias-border-l1);
}
.dgw-rb__vsplit:hover { background: var(--dsw-alias-brand-primary); opacity: .35; }
.dgw-rb__diff { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }
.dgw-rb__diffHead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  flex: 0 0 auto;
  padding: 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.dgw-rb__diffTitle { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
.dgw-rb__diffDir {
  min-width: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dgw-rb__diffScroll { flex: 1 1 auto; min-height: 0; overflow: auto; background: var(--dsw-alias-bg-base); }
.dgw-rb__splitter {
  flex: 0 0 6px;
  height: 6px;
  cursor: row-resize;
  border-top: 1px solid var(--dsw-alias-border-l1);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dgw-rb__splitter:hover { background: var(--dsw-alias-brand-primary); opacity: .35; }
.dgw-rb__log { flex: 0 0 auto; display: flex; flex-direction: column; min-height: 120px; background: var(--dsw-alias-bg-base); }
.dgw-rb__logHead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  flex: 0 0 auto;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dgw-rb__logBody { position: relative; flex: 1 1 auto; display: flex; min-height: 0; }
/* The log's branch tree and detail column own their adjustable width; the
   commit list in the middle takes the rest. */
.dgw-rb__logTree { flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.dgw-rb__logTree > .dgw-tree { width: 100%; flex: 1 1 auto; min-width: 0; }
.dgw-rb__logDetails { flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.dgw-rb__logDetails > .dgw-details { width: 100%; flex: 1 1 auto; min-width: 0; border-left: 0; }
.dgw-rb__details {
  flex: 0 0 250px;
  width: 250px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--dsw-alias-border-l1);
}
.dgw-rb__detailsHead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.dgw-rb__detailsScroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 10px; }
.dgw-rb__drawer {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
}
.dgw-rb__drawer .dgw-rb__details { flex: 1 1 auto; width: auto; border-left: none; }
.dgw-rb__drawerHead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  flex: 0 0 auto;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dgw-rb__status {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 22px;
  flex: 0 0 auto;
  padding: 0 10px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
}
.dgw-rb__status > span { overflow: hidden; text-overflow: ellipsis; }
.dgw-rb__empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  text-align: center;
}
.dgw-rb__emptyBox { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: 320px; }
.dgw-iconBtn--active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }

/* Labelled header actions: glyph + short word, with the long explanation in the
   native tooltip. Narrow right-column panes keep only the glyphs. */
.dgw-rb__tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px;
  flex: 0 0 auto;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.dgw-rb__tool:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dgw-rb__tool:disabled { opacity: .45; cursor: default; }
.dgw-rb__tool--active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dgw-rb__toolText { font-size: 11px; }
.dgw-rb__top--compact .dgw-rb__toolText { display: none; }
.dgw-rb__top--compact .dgw-rb__tool { padding: 0 5px; }
.dgw-rb__top--compact { gap: 4px; }

/* The commit form is designed for the wide main panel. Inside the narrow
   right-column pane its row must wrap into stable lines instead of shrinking
   every label/button until the characters stack vertically. */
.dgw-rb .dgw-commitForm { padding: 8px; gap: 6px; }
.dgw-rb .dgw-commitForm .dgw-formRow { flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.dgw-rb .dgw-commitForm .dgw-label,
.dgw-rb .dgw-commitForm .dgw-btn,
.dgw-rb .dgw-commitForm .dgw-meta { flex: 0 0 auto; white-space: nowrap; }
.dgw-rb .dgw-commitForm .dgw-btn { padding: 0 8px; }
.dgw-rb .dgw-commitForm .dgw-spacer { flex: 1 1 100%; height: 0; }
.dgw-rb .dgw-commitForm .dgw-meta { margin-left: auto; }
.dgw-rb .dgw-commitForm .dgw-textarea { min-height: 52px; max-height: 120px; }
`;
		/** The values a Session starts with before it recorded anything. */
		const DEFAULT_PREFS = {
			commitOpen: null,
			commitWidth: 320,
			logTreeWidth: 240,
			logDetailWidth: 320,
			logHeight: 320,
			diffMode: "auto"
		};
		/** Browser-local key prefix; the Session id follows it. */
		const KEY_PREFIX = "dsh.git-window.rightbar.";
		/** The storage key for one Session. */
		function prefsKey(sessionId) {
			return KEY_PREFIX + sessionId;
		}
		/** Clamp a number into a range, falling back when it is not finite. */
		function clamp(value, min, max, fallback) {
			if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
			return Math.min(Math.max(min, Math.round(value)), max);
		}
		/** Validate one stored document; any malformed field falls back on its own. */
		function sanitize(value) {
			if (typeof value !== "object" || value === null) return DEFAULT_PREFS;
			const record = value;
			const commitOpen = record.commitOpen === true ? true : record.commitOpen === false ? false : null;
			const diffMode = record.diffMode === "unified" || record.diffMode === "side" ? record.diffMode : "auto";
			return {
				commitOpen,
				commitWidth: clamp(record.commitWidth, 280, 520, 320),
				logTreeWidth: clamp(record.logTreeWidth, 180, 420, 240),
				logDetailWidth: clamp(record.logDetailWidth, 240, 560, 320),
				logHeight: clamp(record.logHeight, 140, 2e3, 320),
				diffMode
			};
		}
		/** Read one Session's preferences; a missing or denied store answers defaults. */
		function readPrefs(sessionId) {
			if (typeof localStorage === "undefined") return DEFAULT_PREFS;
			try {
				const raw = localStorage.getItem(prefsKey(sessionId));
				if (raw === null) return DEFAULT_PREFS;
				return sanitize(JSON.parse(raw));
			} catch {
				return DEFAULT_PREFS;
			}
		}
		/** Write one Session's preferences; denial is not an error. */
		function writePrefs(sessionId, prefs) {
			if (typeof localStorage === "undefined") return;
			try {
				localStorage.setItem(prefsKey(sessionId), JSON.stringify(prefs));
			} catch {}
		}
		//#endregion
		//#region src/git-workspace/window/rightbar/model.ts
		/**
		* State machine of the Git right-column page: the same Host round-trips the main
		* panel performs, shaped for a one-page layout (commit panel + diff above, log
		* below).
		*
		* The hook owns every fetch, selection, dialog and job decision, so the
		* presentational layout stays plain props and an SSR test can render it from a
		* fixture. Actions that need panel navigation (fullscreen, closing the tab)
		* stay in the page wrapper: they call services the slot context provides, not
		* the Host routes this module talks to.
		*
		* @module dsh-session-map/git-workspace/window/rightbar/model
		*/
		/** Poll interval while the page is visible. */
		const POLL_VISIBLE_MS = 3e3;
		/** Poll interval after the page has been hidden for a while. */
		const POLL_HIDDEN_MS = 1e4;
		/** Normalize one thrown value. */
		function toApiError(error) {
			return error instanceof GitApiError ? error : new GitApiError("internal", error instanceof Error ? error.message : String(error));
		}
		/** The diff presentation a preference resolves to at this width. */
		function resolveDiffMode(pref, width) {
			if (pref === "unified" || pref === "side") return pref;
			return width >= 700 ? "side" : "unified";
		}
		/** Build the page state machine over one Host runtime and one workspace. */
		function useGitRightbarModel(deps) {
			const { runtime, workspaceId, width, prefs, onPrefs } = deps;
			const [refreshKey, setRefreshKey] = react.useState(0);
			const [snapshot, setSnapshot] = react.useState(null);
			const [snapshotLoading, setSnapshotLoading] = react.useState(false);
			const [snapshotError, setSnapshotError] = react.useState(null);
			const [branchFilter, setBranchFilter] = react.useState(null);
			const [queryInput, setQueryInput] = react.useState("");
			const [query, setQuery] = react.useState("");
			const [commits, setCommits] = react.useState([]);
			const [logHasMore, setLogHasMore] = react.useState(false);
			const [logLoading, setLogLoading] = react.useState(false);
			const [logLoadingMore, setLogLoadingMore] = react.useState(false);
			const [logError, setLogError] = react.useState(null);
			const [selectedOid, setSelectedOid] = react.useState(null);
			const [detail, setDetail] = react.useState(null);
			const [detailLoading, setDetailLoading] = react.useState(false);
			const [detailError, setDetailError] = react.useState(null);
			const [target, setTarget] = react.useState(null);
			const [diff, setDiff] = react.useState(null);
			const [diffLoading, setDiffLoading] = react.useState(false);
			const [diffError, setDiffError] = react.useState(null);
			const [actionError, setActionError] = react.useState(null);
			const [job, setJob] = react.useState(null);
			const [jobBusy, setJobBusy] = react.useState(false);
			const [branchDialog, setBranchDialog] = react.useState(null);
			const [resetDialog, setResetDialog] = react.useState(null);
			const [tagDialog, setTagDialog] = react.useState(null);
			const [tagDeleteDialog, setTagDeleteDialog] = react.useState(null);
			const [forcePushDialog, setForcePushDialog] = react.useState(null);
			const refresh = react.useCallback(() => setRefreshKey((key) => key + 1), []);
			const updatePrefs = react.useCallback((patch) => {
				onPrefs({
					...prefs,
					...patch
				});
			}, [onPrefs, prefs]);
			react.useEffect(() => {
				if (workspaceId === null) {
					setSnapshot(null);
					setSnapshotLoading(false);
					return;
				}
				let stopped = false;
				const controller = new AbortController();
				let timer;
				setSnapshotLoading(true);
				const tick = async () => {
					try {
						const result = await runtime.snapshot(workspaceId, controller.signal);
						if (stopped) return;
						setSnapshot(result.snapshot);
						setSnapshotError(null);
					} catch (error) {
						if (stopped || isAbortError$1(error)) return;
						setSnapshotError(toApiError(error));
					} finally {
						if (stopped) return;
						setSnapshotLoading(false);
						timer = setTimeout(tick, document.visibilityState === "hidden" ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
					}
				};
				tick();
				const onVisibility = () => {
					if (document.visibilityState !== "visible") return;
					if (timer !== void 0) clearTimeout(timer);
					tick();
				};
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					stopped = true;
					controller.abort();
					if (timer !== void 0) clearTimeout(timer);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, [
				runtime,
				workspaceId,
				refreshKey
			]);
			react.useEffect(() => {
				const timer = setTimeout(() => setQuery(queryInput.trim()), 300);
				return () => clearTimeout(timer);
			}, [queryInput]);
			react.useEffect(() => {
				setSelectedOid(null);
				setDetail(null);
				setTarget(null);
				setDiff(null);
			}, [
				workspaceId,
				branchFilter,
				query
			]);
			react.useEffect(() => {
				if (workspaceId === null) {
					setCommits([]);
					setLogHasMore(false);
					return;
				}
				let stopped = false;
				const controller = new AbortController();
				setLogLoading(true);
				const request = {
					workspaceId,
					limit: 50,
					...branchFilter === null ? {} : { ref: branchFilter },
					...query === "" ? {} : { query }
				};
				runtime.log(request, controller.signal).then((page) => {
					if (stopped) return;
					setCommits(page.commits);
					setLogHasMore(page.hasMore);
					setLogError(null);
				}).catch((error) => {
					if (stopped || isAbortError$1(error)) return;
					setLogError(toApiError(error));
				}).finally(() => {
					if (!stopped) setLogLoading(false);
				});
				return () => {
					stopped = true;
					controller.abort();
				};
			}, [
				runtime,
				workspaceId,
				branchFilter,
				query,
				refreshKey
			]);
			react.useEffect(() => {
				if (workspaceId === null || selectedOid === null) {
					setDetail(null);
					setDetailLoading(false);
					return;
				}
				let stopped = false;
				const controller = new AbortController();
				setDetailLoading(true);
				runtime.commit(workspaceId, selectedOid, controller.signal).then((result) => {
					if (stopped) return;
					setDetail(result.commit);
					setDetailError(null);
					const first = result.commit.files[0];
					if (first !== void 0) setTarget({
						kind: "commit",
						hash: result.commit.oid,
						path: first.path
					});
				}).catch((error) => {
					if (stopped || isAbortError$1(error)) return;
					setDetailError(toApiError(error));
				}).finally(() => {
					if (!stopped) setDetailLoading(false);
				});
				return () => {
					stopped = true;
					controller.abort();
				};
			}, [
				runtime,
				workspaceId,
				selectedOid,
				refreshKey
			]);
			react.useEffect(() => {
				if (workspaceId === null || target === null) {
					setDiff(null);
					setDiffLoading(false);
					return;
				}
				if (target.kind === "change" && target.group === "untracked") {
					setDiff(null);
					setDiffLoading(false);
					setDiffError(null);
					return;
				}
				let stopped = false;
				const controller = new AbortController();
				setDiffLoading(true);
				const request = target.kind === "commit" ? {
					workspaceId,
					hash: target.hash,
					file: target.path,
					context: 3
				} : {
					workspaceId,
					file: target.path,
					staged: target.group === "staged",
					context: 3
				};
				runtime.diff(request, controller.signal).then((result) => {
					if (stopped) return;
					setDiff(parseUnifiedDiff(result.patch, target.path, result.truncated));
					setDiffError(null);
				}).catch((error) => {
					if (stopped || isAbortError$1(error)) return;
					setDiffError(toApiError(error));
				}).finally(() => {
					if (!stopped) setDiffLoading(false);
				});
				return () => {
					stopped = true;
					controller.abort();
				};
			}, [
				runtime,
				workspaceId,
				target,
				refreshKey
			]);
			react.useEffect(() => {
				setSelectedOid((current) => current !== null && commits.some((commit) => commit.oid === current) ? current : null);
			}, [commits]);
			const runSimple = async (action) => {
				if (workspaceId === null) return;
				setActionError(null);
				try {
					await runtime.action(action);
					refresh();
				} catch (error) {
					setActionError(toApiError(error));
				}
			};
			/** Follow one job through SSE, falling back to polling when the stream fails. */
			const watchJob = react.useCallback((id) => {
				let stopped = false;
				let source;
				const finish = (view) => {
					if (stopped) return;
					setJob(view);
					if (view.status === "running") return;
					stopped = true;
					source?.close();
					setJobBusy(false);
					if (view.status === "failed" && view.error !== void 0) setActionError(new GitApiError(view.error.code, view.error.message, view.error.detail));
					refresh();
				};
				const poll = async () => {
					if (stopped) return;
					try {
						const view = await runtime.job(id);
						finish(view);
						if (!stopped) setTimeout(() => {
							poll();
						}, 700);
					} catch (error) {
						if (stopped) return;
						setActionError(toApiError(error));
						setJobBusy(false);
					}
				};
				if (typeof EventSource === "undefined") {
					poll();
					return;
				}
				source = new EventSource(`/plugin-git-workspace/events?job=${encodeURIComponent(id)}`);
				source.onmessage = (event) => {
					try {
						finish(JSON.parse(String(event.data)));
					} catch {}
				};
				source.onerror = () => {
					source?.close();
					source = void 0;
					poll();
				};
			}, [refresh, runtime]);
			/** Start one long action and follow its job. */
			const runJob = async (action, confirmToken) => {
				if (workspaceId === null || jobBusy) return;
				setJobBusy(true);
				setActionError(null);
				try {
					const result = await runtime.action(action, confirmToken);
					if (result.job === void 0) {
						setJobBusy(false);
						refresh();
						return;
					}
					setJob({
						id: result.job.id,
						kind: action.kind,
						workspaceId,
						status: "running",
						lines: [],
						startedAt: Date.now()
					});
					watchJob(result.job.id);
				} catch (error) {
					setActionError(toApiError(error));
					setJobBusy(false);
				}
			};
			const fetchAll = () => {
				if (workspaceId === null) return;
				runJob({
					kind: "fetch",
					workspaceId,
					all: true
				});
			};
			const updateBranch = (mode) => {
				if (workspaceId === null) return;
				runJob({
					kind: "update",
					workspaceId,
					mode
				});
			};
			const push = (forceWithLease = false) => {
				if (workspaceId === null || snapshot === null) return;
				const branch = snapshot.head.branch;
				if (branch === null) {
					setActionError(new GitApiError("detached-head", "HEAD is detached"));
					return;
				}
				const remote = snapshot.remotes[0]?.name;
				const needsUpstream = snapshot.head.upstream === null;
				if (needsUpstream && remote === void 0) {
					setActionError(new GitApiError("no-upstream", "no remote is configured"));
					return;
				}
				if (forceWithLease) {
					const action = {
						kind: "push",
						workspaceId,
						branch,
						forceWithLease: true,
						...remote === void 0 ? {} : { remote }
					};
					runtime.confirm(action).then(async (confirmation) => {
						await runJob(action, confirmation.token);
					}).catch((error) => {
						setActionError(toApiError(error));
					});
					return;
				}
				runJob({
					kind: "push",
					workspaceId,
					...needsUpstream && remote !== void 0 ? {
						remote,
						branch,
						setUpstream: true
					} : {}
				});
			};
			const cancelJob = () => {
				if (job === null) return;
				runtime.cancelJob(job.id).then(() => {
					setJobBusy(false);
				}).catch((error) => {
					setActionError(toApiError(error));
					setJobBusy(false);
				});
			};
			const continueOperation = () => {
				if (workspaceId === null || snapshot === null) return;
				const operation = snapshot.head.operation;
				if (operation === "none" || operation === "bisect") return;
				runSimple({
					kind: "continueOperation",
					workspaceId,
					operation: operation === "rebase-apply" ? "rebase" : operation
				});
			};
			const abortOperation = () => {
				if (workspaceId === null || snapshot === null) return;
				const operation = snapshot.head.operation;
				if (operation === "none" || operation === "bisect") return;
				runSimple({
					kind: "abortOperation",
					workspaceId,
					operation: operation === "rebase-apply" ? "rebase" : operation
				});
			};
			const openBranchDialog = (prompt, initial) => {
				setBranchDialog({
					prompt,
					value: initial,
					force: false,
					busy: false,
					error: null
				});
			};
			const submitBranchDialog = async () => {
				if (workspaceId === null || branchDialog === null || branchDialog.busy) return;
				const name = branchDialog.value.trim();
				if (branchDialog.prompt.kind !== "delete" && name === "") return;
				setBranchDialog({
					...branchDialog,
					busy: true,
					error: null
				});
				try {
					if (branchDialog.prompt.kind === "create") await runtime.action({
						kind: "createBranch",
						workspaceId,
						name,
						...branchDialog.prompt.start === void 0 ? {} : { start: branchDialog.prompt.start }
					});
					else if (branchDialog.prompt.kind === "rename") await runtime.action({
						kind: "renameBranch",
						workspaceId,
						from: branchDialog.prompt.branch ?? "",
						to: name
					});
					else {
						const action = {
							kind: "deleteBranch",
							workspaceId,
							name: branchDialog.prompt.branch ?? "",
							force: branchDialog.force
						};
						const confirmation = await runtime.confirm(action);
						await runtime.action(action, confirmation.token);
					}
					setBranchDialog(null);
					refresh();
				} catch (error) {
					setBranchDialog((current) => current === null ? null : {
						...current,
						busy: false,
						error: toApiError(error)
					});
				}
			};
			const submitReset = async () => {
				if (workspaceId === null || resetDialog === null || resetDialog.busy) return;
				setResetDialog({
					...resetDialog,
					busy: true,
					error: null
				});
				try {
					const action = {
						kind: "reset",
						workspaceId,
						hash: resetDialog.target,
						mode: resetDialog.mode
					};
					const confirmation = await runtime.confirm(action);
					await runtime.action(action, confirmation.token);
					setResetDialog(null);
					refresh();
				} catch (error) {
					setResetDialog((current) => current === null ? null : {
						...current,
						busy: false,
						error: toApiError(error)
					});
				}
			};
			const submitTag = async () => {
				if (workspaceId === null || tagDialog === null || tagDialog.busy) return;
				const name = tagDialog.value.trim();
				if (name === "") return;
				setTagDialog({
					...tagDialog,
					busy: true,
					error: null
				});
				try {
					await runtime.action({
						kind: "tagCreate",
						workspaceId,
						name,
						hash: tagDialog.target
					});
					setTagDialog(null);
					refresh();
				} catch (error) {
					setTagDialog((current) => current === null ? null : {
						...current,
						busy: false,
						error: toApiError(error)
					});
				}
			};
			const submitTagDelete = async () => {
				if (workspaceId === null || tagDeleteDialog === null || tagDeleteDialog.busy) return;
				setTagDeleteDialog({
					...tagDeleteDialog,
					busy: true,
					error: null
				});
				try {
					const action = {
						kind: "tagDelete",
						workspaceId,
						name: tagDeleteDialog.name
					};
					const confirmation = await runtime.confirm(action);
					await runtime.action(action, confirmation.token);
					setTagDeleteDialog(null);
					refresh();
				} catch (error) {
					setTagDeleteDialog((current) => current === null ? null : {
						...current,
						busy: false,
						error: toApiError(error)
					});
				}
			};
			const submitForcePush = async () => {
				if (workspaceId === null || forcePushDialog === null || forcePushDialog.busy) return;
				setForcePushDialog({
					...forcePushDialog,
					busy: true,
					error: null
				});
				try {
					const remote = snapshot?.remotes[0]?.name;
					const action = {
						kind: "push",
						workspaceId,
						branch: forcePushDialog.branch,
						forceWithLease: true,
						...remote === void 0 ? {} : { remote }
					};
					const confirmation = await runtime.confirm(action);
					setForcePushDialog(null);
					await runJob(action, confirmation.token);
				} catch (error) {
					setForcePushDialog((current) => current === null ? null : {
						...current,
						busy: false,
						error: toApiError(error)
					});
				}
			};
			const graph = react.useMemo(() => computeGraph(commits), [commits]);
			const banner = [
				snapshotError,
				logError,
				detailError,
				diffError,
				actionError
			].filter((error) => error !== null)[0] ?? null;
			const notRepo = snapshotError?.code === "not-a-repository";
			const commitOpen = prefs.commitOpen === null ? true : prefs.commitOpen;
			const diffHint = target !== null && target.kind === "change" && target.group === "untracked" ? "未跟踪文件没有差异可显示" : void 0;
			const actions = {
				refresh,
				retry: () => {
					setSnapshotError(null);
					setLogError(null);
					setDetailError(null);
					setDiffError(null);
					setActionError(null);
					refresh();
				},
				fetchAll,
				updateBranch,
				push,
				cancelJob,
				search: (value) => setQueryInput(value),
				clearBranch: () => setBranchFilter(null),
				selectBranch: (ref) => setBranchFilter(ref),
				loadMore: () => {
					if (workspaceId === null || logLoadingMore) return;
					const controller = new AbortController();
					setLogLoadingMore(true);
					runtime.log({
						workspaceId,
						limit: 50,
						skip: commits.length,
						...branchFilter === null ? {} : { ref: branchFilter },
						...query === "" ? {} : { query }
					}, controller.signal).then((page) => {
						setCommits((previous) => [...previous, ...page.commits]);
						setLogHasMore(page.hasMore);
					}).catch((error) => {
						if (!isAbortError$1(error)) setLogError(toApiError(error));
					}).finally(() => setLogLoadingMore(false));
				},
				selectCommit: (oid) => setSelectedOid(oid),
				selectChange: (entry) => setTarget({
					kind: "change",
					path: entry.path,
					group: entry.group
				}),
				selectCommitFile: (path) => {
					if (detail === null) return;
					setTarget({
						kind: "commit",
						hash: detail.oid,
						path
					});
				},
				continueOperation,
				abortOperation,
				checkoutBranch: (ref) => {
					if (workspaceId === null) return;
					runSimple({
						kind: "checkout",
						workspaceId,
						ref
					});
				},
				openCreateBranch: (start) => openBranchDialog({
					kind: "create",
					...start === void 0 ? {} : { start }
				}, ""),
				openRenameBranch: (name) => openBranchDialog({
					kind: "rename",
					branch: name
				}, name),
				openDeleteBranch: (name) => openBranchDialog({
					kind: "delete",
					branch: name
				}, ""),
				mergeBranch: (ref) => {
					if (workspaceId === null) return;
					runSimple({
						kind: "merge",
						workspaceId,
						ref
					});
				},
				rebaseBranch: (ref) => {
					if (workspaceId === null) return;
					runSimple({
						kind: "rebase",
						workspaceId,
						onto: ref
					});
				},
				deleteTag: (name) => setTagDeleteDialog({
					name,
					busy: false,
					error: null
				}),
				openForcePush: (name) => setForcePushDialog({
					branch: name,
					busy: false,
					error: null
				}),
				cherryPick: (oid) => {
					if (workspaceId === null) return;
					runSimple({
						kind: "cherryPick",
						workspaceId,
						hash: oid
					});
				},
				revert: (oid) => {
					if (workspaceId === null) return;
					runSimple({
						kind: "revert",
						workspaceId,
						hash: oid
					});
				},
				openReset: (oid) => setResetDialog({
					target: oid,
					mode: "mixed",
					busy: false,
					error: null
				}),
				openTagCreate: (oid) => setTagDialog({
					target: oid,
					value: "",
					busy: false,
					error: null
				}),
				changesChanged: refresh,
				toggleCommitPanel: () => updatePrefs({ commitOpen: !commitOpen }),
				setCommitWidth: (next) => updatePrefs({ commitWidth: Math.min(Math.max(280, Math.round(next)), 520) }),
				setLogTreeWidth: (next) => updatePrefs({ logTreeWidth: Math.min(Math.max(180, Math.round(next)), 420) }),
				setLogDetailWidth: (next) => updatePrefs({ logDetailWidth: Math.min(Math.max(240, Math.round(next)), 560) }),
				setLogHeight: (next) => updatePrefs({ logHeight: Math.max(140, Math.round(next)) }),
				cycleDiffMode: () => {
					const resolved = resolveDiffMode(prefs.diffMode, width);
					updatePrefs({ diffMode: resolved === "side" ? "unified" : "side" });
				},
				setBranchValue: (value) => setBranchDialog((current) => current === null ? null : {
					...current,
					value
				}),
				setBranchForce: (force) => setBranchDialog((current) => current === null ? null : {
					...current,
					force
				}),
				cancelBranchDialog: () => setBranchDialog((current) => current === null || current.busy ? current : null),
				confirmBranchDialog: () => {
					submitBranchDialog();
				},
				setResetMode: (mode) => setResetDialog((current) => current === null ? null : {
					...current,
					mode
				}),
				cancelResetDialog: () => setResetDialog((current) => current === null || current.busy ? current : null),
				confirmResetDialog: () => {
					submitReset();
				},
				setTagValue: (value) => setTagDialog((current) => current === null ? null : {
					...current,
					value
				}),
				cancelTagDialog: () => setTagDialog((current) => current === null || current.busy ? current : null),
				confirmTagDialog: () => {
					submitTag();
				},
				cancelTagDeleteDialog: () => setTagDeleteDialog((current) => current === null || current.busy ? current : null),
				confirmTagDeleteDialog: () => {
					submitTagDelete();
				},
				cancelForcePushDialog: () => setForcePushDialog((current) => current === null || current.busy ? current : null),
				confirmForcePushDialog: () => {
					submitForcePush();
				}
			};
			return {
				runtime,
				workspaceId,
				snapshot,
				snapshotLoading,
				banner,
				notRepo,
				head: snapshot?.head ?? null,
				branches: snapshot?.branches ?? [],
				commits,
				graph,
				logLoading,
				logHasMore,
				branchFilter,
				queryInput,
				selectedOid,
				detail,
				detailLoading,
				target,
				diff,
				diffLoading,
				diffHint,
				diffMode: resolveDiffMode(prefs.diffMode, width),
				commitOpen,
				commitWidth: Math.min(Math.max(280, prefs.commitWidth), Math.max(280, width - 320)),
				logTreeWidth: prefs.logTreeWidth,
				logDetailWidth: prefs.logDetailWidth,
				logHeight: prefs.logHeight,
				job,
				jobBusy,
				branchDialog,
				resetDialog,
				tagDialog,
				tagDeleteDialog,
				forcePushDialog,
				actions
			};
		}
		/** Job label used by the status bar. */
		function jobStatusLabel(view) {
			if (view.status === "running") return "进行中";
			if (view.status === "done") return "完成";
			if (view.status === "cancelled") return "已取消";
			return "失败";
		}
		//#endregion
		//#region src/git-workspace/window/rightbar/layout.ts
		/**
		* Layout of the Git right-column page: toolbar, commit panel + diff above, the
		* log (branch tree / commit list / commit details) below, and a status bar.
		*
		* Presentational only: every fetch, selection and dialog decision lives in
		* {@link useGitRightbarModel}, so this file can be rendered from fixtures at
		* either breakpoint.
		*
		* @module dsh-session-map/git-workspace/window/rightbar/layout
		*/
		/** The HEAD placeholder used before the first snapshot lands. */
		const EMPTY_HEAD = {
			oid: null,
			branch: null,
			detached: false,
			unborn: false,
			upstream: null,
			operation: "none"
		};
		/** Width below which the branch tree gives its space to the commit list. */
		const BRANCHES_MIN_WIDTH = 520;
		/** Width at which the commit-details column fits beside the list. */
		const DETAILS_MIN_WIDTH = 800;
		/** Copy text without surfacing a failure. */
		function copy(text) {
			if (typeof navigator === "undefined" || navigator.clipboard === void 0) return;
			navigator.clipboard.writeText(text).catch(() => void 0);
		}
		/** One toolbar/footer icon button. */
		function iconButton(key, title, glyph, onClick, options) {
			return react.createElement("button", {
				key,
				className: "dgw-iconBtn" + (options?.active === true ? " dgw-iconBtn--active" : ""),
				type: "button",
				title,
				"aria-label": title,
				onClick,
				disabled: options?.disabled === true
			}, glyph);
		}
		/**
		* One labelled toolbar button: the glyph plus a short word, with the longer
		* explanation in the native tooltip. The right-column page's header used to be a
		* row of anonymous glyphs, which is hard to read without hovering each one.
		*/
		function toolButton(key, label, detail, glyph, onClick, options) {
			return react.createElement("button", {
				key,
				className: "dgw-rb__tool" + (options?.active === true ? " dgw-rb__tool--active" : ""),
				type: "button",
				title: detail,
				"aria-label": detail,
				onClick,
				disabled: options?.disabled === true
			}, glyph, react.createElement("span", { className: "dgw-rb__toolText" }, label));
		}
		/** Render the commit-detail column (metadata + file list; the diff is above). */
		function DetailsColumn(props) {
			const { model } = props;
			if (model.detail === null) return react.createElement("div", { className: "dgw-rb__empty" }, react.createElement("div", { className: "dgw-rb__emptyBox" }, react.createElement("div", null, model.detailLoading ? "正在加载提交详情…" : "选择一个提交查看详情")));
			const detail = model.detail;
			return react.createElement("div", { className: "dgw-rb__details" }, react.createElement("div", { className: "dgw-rb__detailsHead" }, react.createElement("span", { className: "dgw-hash" }, detail.shortOid), react.createElement("button", {
				className: "dgw-iconBtn",
				type: "button",
				title: "复制完整哈希",
				onClick: () => copy(detail.oid)
			}, react.createElement(CopyIcon, { size: 13 })), react.createElement("span", { className: "dgw-spacer" }), react.createElement("span", { className: "dgw-meta" }, `${detail.files.length} 个文件`)), react.createElement("div", { className: "dgw-rb__detailsScroll" }, react.createElement(CommitMeta, { detail }), react.createElement(CommitFiles, {
				files: detail.files,
				selectedFile: model.target !== null && model.target.kind === "commit" ? model.target.path : null,
				onSelectFile: model.actions.selectCommitFile
			})));
		}
		/** Render the page. */
		function GitRightbarLayout(props) {
			const { model } = props;
			const { width, height } = props.size;
			const commitOpen = model.commitOpen;
			const commitWidth = Math.min(model.commitWidth, Math.max(280, width - 320));
			const logHeight = Math.min(model.logHeight, Math.max(160, height - 220));
			const showBranches = width >= BRANCHES_MIN_WIDTH;
			const showDetails = width >= DETAILS_MIN_WIDTH;
			const [drag, setDrag] = react.useState(null);
			const [dragValue, setDragValue] = react.useState(null);
			const [drawerOpen, setDrawerOpen] = react.useState(false);
			const [updateDialog, setUpdateDialog] = react.useState(null);
			const [pushOpen, setPushOpen] = react.useState(false);
			const [pushPreview, setPushPreview] = react.useState(null);
			const [pushPreviewLoading, setPushPreviewLoading] = react.useState(false);
			const [pushPreviewError, setPushPreviewError] = react.useState(null);
			const [pushForce, setPushForce] = react.useState(false);
			const openPushPreview = async () => {
				if (model.workspaceId === null) return;
				setPushOpen(true);
				setPushPreviewLoading(true);
				setPushPreview(null);
				setPushPreviewError(null);
				setPushForce(false);
				try {
					const result = await model.runtime.pushPreview(model.workspaceId);
					setPushPreview(result.preview);
				} catch (error) {
					setPushPreviewError(error instanceof Error ? error.message : String(error));
				} finally {
					setPushPreviewLoading(false);
				}
			};
			const upstreamRef = model.head?.upstream?.ref ?? null;
			const upstreamOid = upstreamRef === null ? null : model.branches.find((branch) => branch.type === "remote" && (branch.ref === upstreamRef || branch.name === upstreamRef || upstreamRef.endsWith("/" + branch.name)))?.oid ?? null;
			const openUpdate = () => {
				setUpdateDialog({ mode: readUpdateMode() });
			};
			const confirmUpdate = () => {
				if (updateDialog === null) return;
				const mode = updateDialog.mode;
				writeUpdateMode(mode);
				setUpdateDialog(null);
				model.actions.updateBranch(mode);
			};
			react.useEffect(() => {
				if (drag === null) return void 0;
				const move = (event) => {
					const delta = drag.kind === "log" ? drag.start - event.clientY : drag.kind === "logDetail" ? drag.start - event.clientX : event.clientX - drag.start;
					setDragValue(drag.base + delta);
				};
				const up = () => {
					const value = dragValue;
					if (value !== null) {
						if (drag.kind === "log") model.actions.setLogHeight(value);
						else if (drag.kind === "commit") model.actions.setCommitWidth(value);
						else if (drag.kind === "logTree") model.actions.setLogTreeWidth(value);
						else model.actions.setLogDetailWidth(value);
					}
					setDrag(null);
					setDragValue(null);
				};
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up);
				return () => {
					window.removeEventListener("pointermove", move);
					window.removeEventListener("pointerup", up);
				};
			}, [
				drag,
				dragValue,
				model.actions
			]);
			const effectiveCommitWidth = drag !== null && drag.kind === "commit" && dragValue !== null ? dragValue : commitWidth;
			const effectiveLogHeight = drag !== null && drag.kind === "log" && dragValue !== null ? Math.min(dragValue, Math.max(160, height - 220)) : logHeight;
			const logTreeWidth = drag !== null && drag.kind === "logTree" && dragValue !== null ? Math.min(Math.max(180, dragValue), 420) : model.logTreeWidth;
			const logDetailWidth = drag !== null && drag.kind === "logDetail" && dragValue !== null ? Math.min(Math.max(240, dragValue), 560) : model.logDetailWidth;
			const head = model.head ?? EMPTY_HEAD;
			const counts = model.snapshot?.counts;
			const ahead = head.upstream?.ahead ?? 0;
			const behind = head.upstream?.behind ?? 0;
			const compactToolbar = width < 700;
			const stats = diffStats(model.diff);
			const targetFile = model.target?.path ?? null;
			const targetLabel = model.target === null ? null : model.target.kind === "commit" ? "提交 " + model.target.hash.slice(0, 7) : model.target.group === "staged" ? "暂存区" : model.target.group === "untracked" ? "未跟踪" : "工作区";
			const diffHeader = react.createElement("div", { className: "dgw-rb__diffHead" }, react.createElement("span", {
				className: "dgw-rb__diffTitle",
				title: targetFile ?? ""
			}, targetFile === null ? "仓库差异" : "仓库差异: " + (targetFile.split("/").pop() ?? targetFile)), targetFile === null ? null : react.createElement("span", { className: "dgw-rb__diffDir" }, targetFile.slice(0, targetFile.length - (targetFile.split("/").pop() ?? "").length)), targetLabel === null ? null : react.createElement("span", { className: "dgw-rb__chip" }, targetLabel), react.createElement("span", { className: "dgw-spacer" }), model.diff === null ? null : react.createElement("span", { className: "dgw-rb__chip" }, "+" + stats.adds + " −" + stats.dels), iconButton("mode", model.diffMode === "side" ? "切换为统一视图" : "切换为并排视图", model.diffMode === "side" ? react.createElement(UnifiedIcon, { size: 13 }) : react.createElement(SideBySideIcon, { size: 13 }), model.actions.cycleDiffMode));
			const toolbar = react.createElement("div", { className: "dgw-rb__top" + (compactToolbar ? " dgw-rb__top--compact" : "") }, react.createElement("span", { className: "dgw-brand" }, react.createElement(GitPanelIcon, {
				size: 16,
				active: true
			}), react.createElement("span", null, "Git")), head.branch === null ? null : react.createElement("span", { className: "dgw-rb__chip" }, head.branch), props.workspaceLabel === "" ? null : react.createElement("span", {
				className: "dgw-rb__repo",
				title: props.workspaceLabel
			}, props.workspaceLabel), ahead === 0 && behind === 0 ? null : react.createElement("span", { className: "dgw-rb__chip" }, "↑" + ahead + " ↓" + behind), counts === void 0 ? null : react.createElement("span", { className: "dgw-rb__chip" }, `${counts.staged} 已暂存 / ${counts.unstaged + counts.untracked + counts.conflicted} 未暂存`), react.createElement("span", { className: "dgw-spacer" }), toolButton("panels", commitOpen ? "收起变更" : "变更", commitOpen ? "收起左侧提交面板：提交信息、暂存区与差异预览" : "展开左侧提交面板：提交信息、暂存区与差异预览", react.createElement(PanelLeftIcon, { size: 14 }), model.actions.toggleCommitPanel, { active: commitOpen }), toolButton("refresh", "刷新", "重新读取工作区状态、分支和提交列表（只读，不联网）", react.createElement(RefreshIcon, { size: 14 }), model.actions.retry, { disabled: model.workspaceId === null || model.snapshotLoading }), toolButton("fetch", "下载远端状态", "下载远端状态：获取所有远端的最新引用（fetch --all --prune）；只更新远端跟踪分支，不修改工作区或本地分支", react.createElement(FetchIcon, { size: 14 }), model.actions.fetchAll, { disabled: model.workspaceId === null || model.jobBusy }), toolButton("update", "更新当前分支", "更新当前分支：先下载远端状态，再按弹窗选择合并或变基；有未提交更改时会被拒绝", react.createElement(RefreshIcon, { size: 14 }), openUpdate, { disabled: model.workspaceId === null || model.jobBusy }), toolButton("push", "推送", "推送当前分支到远端；会先预览待推送提交与文件", react.createElement(PushIcon, { size: 14 }), () => {
				openPushPreview();
			}, { disabled: model.workspaceId === null || model.jobBusy || model.snapshot === null }));
			const statusBar = react.createElement("div", { className: "dgw-rb__status" }, react.createElement("span", null, model.snapshot?.repo.root ?? ""), head.operation !== "none" ? react.createElement(react.Fragment, null, react.createElement("span", null, `正在${head.operation}…`), react.createElement("button", {
				className: "dgw-retry",
				type: "button",
				onClick: model.actions.continueOperation
			}, "继续"), react.createElement("button", {
				className: "dgw-retry",
				type: "button",
				onClick: model.actions.abortOperation
			}, "中止操作")) : null, model.job === null ? null : react.createElement("span", null, `作业 ${model.job.kind}：${jobStatusLabel(model.job)}` + (model.job.status === "running" && model.job.lines.length > 0 ? "  " + (model.job.lines[model.job.lines.length - 1] ?? "") : "")), model.job !== null && model.job.status === "running" ? react.createElement("button", {
				className: "dgw-retry",
				type: "button",
				onClick: model.actions.cancelJob
			}, "取消") : null, react.createElement("span", { className: "dgw-spacer" }), model.snapshot === null ? null : react.createElement("span", null, `${head.branch ?? (head.detached ? "HEAD 已分离" : "HEAD")} · 更新于 ${formatWhen(new Date(model.snapshot.takenAt).toISOString())}`), react.createElement("span", null, `${width}×${height} · ${model.diffMode === "side" ? "并排" : "统一"}`));
			const logHead = react.createElement("div", { className: "dgw-rb__logHead" }, react.createElement("span", { className: "dgw-log-title" }, "Git 日志"), react.createElement("span", { className: "dgw-meta" }, `${model.commits.length} 个提交`), react.createElement("span", { className: "dgw-spacer" }), showDetails ? null : iconButton("detail", "提交详情", react.createElement(ChevronIcon, { size: 13 }), () => setDrawerOpen((open) => !open), { active: drawerOpen }), react.createElement("span", { className: "dgw-meta" }, model.branchFilter === null ? "" : model.branchFilter));
			const logBody = react.createElement("div", { className: "dgw-rb__logBody" }, showBranches ? react.createElement("div", {
				className: "dgw-rb__logTree",
				style: {
					width: logTreeWidth,
					flexBasis: logTreeWidth
				}
			}, react.createElement(BranchTree, {
				head,
				branches: model.branches,
				selectedRef: model.branchFilter,
				onSelect: model.actions.selectBranch,
				onCheckout: model.actions.checkoutBranch,
				onCreateBranch: model.actions.openCreateBranch,
				onRenameBranch: model.actions.openRenameBranch,
				onDeleteBranch: model.actions.openDeleteBranch,
				onMergeBranch: model.actions.mergeBranch,
				onRebaseBranch: model.actions.rebaseBranch,
				onDeleteTag: model.actions.deleteTag,
				onForcePush: model.actions.openForcePush
			})) : null, showBranches ? react.createElement("div", {
				className: "dgw-rb__vsplit",
				title: "拖动调整分支树宽度",
				onPointerDown: (event) => {
					event.preventDefault();
					setDrag({
						kind: "logTree",
						start: event.clientX,
						base: logTreeWidth
					});
				}
			}) : null, react.createElement(LogList, {
				commits: model.commits,
				graph: model.graph,
				selectedOid: model.selectedOid,
				branchLabel: model.branchFilter,
				query: model.queryInput,
				loading: model.logLoading,
				hasMore: model.logHasMore,
				onSelect: (oid) => {
					model.actions.selectCommit(oid);
					if (!showDetails) setDrawerOpen(true);
				},
				onQueryChange: model.actions.search,
				onClearBranch: model.actions.clearBranch,
				onLoadMore: model.actions.loadMore,
				onCherryPick: model.actions.cherryPick,
				onRevert: model.actions.revert,
				onReset: model.actions.openReset,
				onTagCreate: model.actions.openTagCreate
			}), showDetails ? react.createElement("div", {
				className: "dgw-rb__vsplit",
				title: "拖动调整提交详情宽度",
				onPointerDown: (event) => {
					event.preventDefault();
					setDrag({
						kind: "logDetail",
						start: event.clientX,
						base: logDetailWidth
					});
				}
			}) : null, showDetails ? react.createElement("div", {
				className: "dgw-rb__logDetails",
				style: {
					width: logDetailWidth,
					flexBasis: logDetailWidth
				}
			}, react.createElement(DetailsColumn, { model })) : null, !showDetails && drawerOpen ? react.createElement("div", { className: "dgw-rb__drawer" }, react.createElement("div", { className: "dgw-rb__drawerHead" }, react.createElement("span", { className: "dgw-log-title" }, "提交详情"), react.createElement("span", { className: "dgw-spacer" }), iconButton("drawer-close", "关闭详情", react.createElement(CloseIcon, { size: 13 }), () => setDrawerOpen(false))), react.createElement(DetailsColumn, { model })) : null);
			let body;
			if (model.workspaceId === null) body = react.createElement("div", { className: "dgw-rb__empty" }, react.createElement("div", { className: "dgw-rb__emptyBox" }, "当前会话没有关联工作区"));
			else if (model.notRepo) body = react.createElement(NoRepo, { onRetry: model.actions.retry });
			else if (model.snapshot === null) body = react.createElement("div", { className: "dgw-rb__empty" }, react.createElement("div", { className: "dgw-rb__emptyBox" }, react.createElement("div", null, model.snapshotLoading ? "正在读取仓库状态…" : "还没有仓库状态"), react.createElement("button", {
				className: "dgw-retry",
				type: "button",
				onClick: model.actions.retry
			}, "重试")));
			else body = react.createElement(react.Fragment, null, react.createElement("div", { className: "dgw-rb__main" }, commitOpen ? react.createElement("div", {
				className: "dgw-rb__commitCol",
				style: { width: effectiveCommitWidth + "px" }
			}, react.createElement(CommitPane, {
				runtime: model.runtime,
				workspaceId: model.workspaceId ?? "",
				snapshot: model.snapshot,
				onChanged: model.actions.changesChanged,
				groupByDirectory: true,
				collapsibleSections: true,
				selectedKey: model.target !== null && model.target.kind === "change" ? `${model.target.group}:${model.target.path}` : null,
				onSelect: model.actions.selectChange
			})) : null, commitOpen ? react.createElement("div", {
				className: "dgw-rb__vsplit",
				title: "拖动调整提交面板宽度",
				onPointerDown: (event) => {
					event.preventDefault();
					setDrag({
						kind: "commit",
						start: event.clientX,
						base: effectiveCommitWidth
					});
				}
			}) : null, react.createElement("div", { className: "dgw-rb__diff" }, diffHeader, react.createElement("div", { className: "dgw-rb__diffScroll" }, react.createElement(DiffView, {
				diff: model.diff,
				file: targetFile,
				loading: model.diffLoading,
				mode: model.diffMode,
				...model.diffHint === void 0 ? {} : { hint: model.diffHint }
			})))), react.createElement("div", {
				className: "dgw-rb__splitter",
				title: "拖动调整日志区高度",
				onPointerDown: (event) => {
					event.preventDefault();
					setDrag({
						kind: "log",
						start: event.clientY,
						base: effectiveLogHeight
					});
				}
			}), react.createElement("div", {
				className: "dgw-rb__log",
				style: { height: effectiveLogHeight + "px" }
			}, logHead, logBody));
			return react.createElement("div", { className: "dgw dgw-rb" }, react.createElement("style", null, CSS$1 + RIGHTBAR_CSS), toolbar, react.createElement(ErrorBanner, {
				error: model.banner,
				onRetry: model.actions.retry
			}), body, statusBar, model.branchDialog === null ? null : react.createElement(BranchDialog, {
				prompt: model.branchDialog.prompt,
				value: model.branchDialog.value,
				force: model.branchDialog.force,
				busy: model.branchDialog.busy,
				error: model.branchDialog.error,
				onValue: model.actions.setBranchValue,
				onForce: model.actions.setBranchForce,
				onCancel: model.actions.cancelBranchDialog,
				onConfirm: model.actions.confirmBranchDialog
			}), model.resetDialog === null ? null : react.createElement(ResetDialog, {
				hash: model.resetDialog.target,
				mode: model.resetDialog.mode,
				busy: model.resetDialog.busy,
				error: model.resetDialog.error,
				onMode: model.actions.setResetMode,
				onCancel: model.actions.cancelResetDialog,
				onConfirm: model.actions.confirmResetDialog
			}), model.tagDialog === null ? null : react.createElement(TagDialog, {
				hash: model.tagDialog.target,
				value: model.tagDialog.value,
				busy: model.tagDialog.busy,
				error: model.tagDialog.error,
				onValue: model.actions.setTagValue,
				onCancel: model.actions.cancelTagDialog,
				onConfirm: model.actions.confirmTagDialog
			}), model.tagDeleteDialog === null ? null : react.createElement(TagDeleteDialog, {
				name: model.tagDeleteDialog.name,
				busy: model.tagDeleteDialog.busy,
				error: model.tagDeleteDialog.error,
				onCancel: model.actions.cancelTagDeleteDialog,
				onConfirm: model.actions.confirmTagDeleteDialog
			}), model.forcePushDialog === null ? null : react.createElement(ForcePushDialog, {
				branch: model.forcePushDialog.branch,
				busy: model.forcePushDialog.busy,
				error: model.forcePushDialog.error,
				onCancel: model.actions.cancelForcePushDialog,
				onConfirm: model.actions.confirmForcePushDialog
			}), updateDialog === null ? null : react.createElement(UpdateDialog, {
				mode: updateDialog.mode,
				busy: model.jobBusy,
				canReset: upstreamOid !== null,
				onMode: (mode) => setUpdateDialog({ mode }),
				onReset: () => {
					if (upstreamOid === null) return;
					setUpdateDialog(null);
					model.actions.openReset(upstreamOid);
				},
				onCancel: () => setUpdateDialog(null),
				onConfirm: confirmUpdate
			}), pushOpen ? react.createElement(PushDialog, {
				branch: model.head?.branch ?? "",
				remote: model.snapshot?.remotes[0]?.name ?? null,
				upstream: model.head?.upstream?.ref ?? null,
				preview: pushPreview,
				loading: pushPreviewLoading,
				error: pushPreviewError,
				busy: model.jobBusy,
				canForce: model.head?.upstream != null,
				force: pushForce,
				onForce: setPushForce,
				loadCommit: async (oid) => {
					if (model.workspaceId === null) throw new Error("no workspace");
					return (await model.runtime.commit(model.workspaceId, oid)).commit;
				},
				onPush: () => {
					setPushOpen(false);
					model.actions.push(pushForce);
				},
				onCancel: () => {
					if (!model.jobBusy) setPushOpen(false);
				}
			}) : null);
		}
		//#endregion
		//#region src/git-workspace/window/rightbar/page.ts
		/**
		* The Git right-column page: resolves the Session's workspace, measures the
		* pane, keeps the per-Session preferences, and mounts the presentational
		* layout over the page state machine.
		*
		* The page is Session-scoped: DSH dispatches `sidebar.right.pane.tab` bodies
		* with the Session id they render for, so the workspace comes from that
		* Session's own workspace row — no workspace picker and no cross-Session
		* leakage.
		*
		* @module dsh-session-map/git-workspace/window/rightbar/page
		*/
		/**
		* Resolve the Session's workspace row.
		*
		* A Session belongs to exactly one Workspace (`items[].sessionIds`), which is
		* what the main panel already uses to pick its default. The first row is the
		* fallback for a Session the list does not know (for example a just-forked
		* Session whose row has not landed yet); a page with no row at all renders its
		* empty state.
		*/
		function resolveWorkspace(items, sessionId) {
			const chosen = items.find((item) => item.sessionIds.includes(sessionId)) ?? items[0];
			if (chosen === void 0) return {
				workspaceId: null,
				label: ""
			};
			return {
				workspaceId: chosen.workspaceId,
				label: chosen.title || chosen.path
			};
		}
		/** Measure one element, reporting zero until the observer lands. */
		function useElementSize() {
			const ref = react.useRef(null);
			const fallback = typeof ResizeObserver === "undefined";
			const [size, setSize] = react.useState({
				width: fallback ? 1200 : 0,
				height: fallback ? 800 : 0
			});
			react.useEffect(() => {
				const element = ref.current;
				if (element === null) return void 0;
				const apply = (nextWidth, nextHeight) => {
					if (nextWidth <= 0 || nextHeight <= 0) return;
					setSize((current) => current.width === nextWidth && current.height === nextHeight ? current : {
						width: nextWidth,
						height: nextHeight
					});
				};
				const rect = element.getBoundingClientRect();
				apply(rect.width, rect.height);
				if (typeof ResizeObserver === "undefined") return void 0;
				const observer = new ResizeObserver((entries) => {
					const entry = entries[0];
					if (entry === void 0) return;
					apply(entry.contentRect.width, entry.contentRect.height);
				});
				observer.observe(element);
				return () => observer.disconnect();
			}, []);
			return {
				ref,
				size
			};
		}
		/** Build the page body over one Host runtime and the slot services. */
		function createGitRightbarPage(runtime) {
			return function GitRightbarPage(props) {
				const { ref, size } = useElementSize();
				const resolved = resolveWorkspace(props.useWorkspaces((state) => state.items), props.sessionId);
				let tabId;
				try {
					tabId = (typeof props.useTabInfo === "function" ? props.useTabInfo() : null)?.tab?.id;
				} catch {
					tabId = void 0;
				}
				const [prefs, setPrefs] = react.useState(() => readPrefs(props.sessionId));
				react.useEffect(() => {
					setPrefs(readPrefs(props.sessionId));
				}, [props.sessionId]);
				const updatePrefs = react.useCallback((next) => {
					setPrefs(next);
					writePrefs(props.sessionId, next);
				}, [props.sessionId]);
				const model = useGitRightbarModel({
					runtime,
					workspaceId: resolved.workspaceId,
					width: size.width,
					prefs,
					onPrefs: updatePrefs
				});
				const close = () => props.closeTab(tabId);
				return react.createElement("div", {
					ref,
					style: {
						display: "flex",
						flexDirection: "column",
						height: "100%",
						minHeight: 0
					}
				}, react.createElement(GitRightbarLayout, {
					size,
					workspaceLabel: resolved.label,
					model,
					onFullscreen: props.openFullscreen,
					onClose: close
				}));
			};
		}
		//#endregion
		//#region src/git-workspace/window/rightbar/install.ts
		/** Normalize one thrown value into display text. */
		function errorText$1(cause) {
			if (cause instanceof Error) return cause.message;
			return String(cause);
		}
		/**
		* Toggle the Git page once.
		*
		* Cold boot can run the header launcher before the right column has mounted its
		* Session surface or claimed its tab types; `openTab` then throws "no session
		* surface is mounted" (or has no type to open). Callers retry while the result is
		* `retry` instead of making the user click a second time.
		* @param ctx - browser root context carrying the right-column services.
		* @returns what one attempt did.
		*/
		function toggleGitRightbar(ctx) {
			const tabs = lookup$1(ctx, "sidebarRightTabs");
			if (tabs === void 0 || tabs.get("git-window") === void 0) return {
				status: "retry",
				reason: "右侧栏标签类型尚未注册"
			};
			const face = lookup$1(ctx, "sidebarRight");
			if (face === void 0) return {
				status: "retry",
				reason: "右侧栏服务尚未挂载"
			};
			try {
				const active = face.active();
				if (active !== void 0 && active.kind === "git-window") {
					face.close(active.id);
					return { status: "closed" };
				}
				lookup$1(ctx, "layout")?.openRightbar?.(true, false);
				face.openTab(GIT_RIGHTBAR_KIND);
				return { status: "opened" };
			} catch (cause) {
				return {
					status: "retry",
					reason: errorText$1(cause)
				};
			}
		}
		/**
		* Build the Session-header launcher: a real button that toggles the page.
		*
		* A rejected toggle used to reach only the console, which reads as a dead
		* button; the reason is shown beside it instead. The button reuses the Session
		* map launcher's classes, which the always-loaded plugin stylesheet owns.
		* @param ctx - browser root context carrying the service lookup.
		* @returns the registered header utility component.
		*/
		function createGitLauncher(ctx) {
			function GitLauncher() {
				const [error, setError] = react.useState(null);
				const pending = react.useRef(false);
				const timer = react.useRef(null);
				react.useEffect(() => () => {
					if (timer.current !== null) clearTimeout(timer.current);
				}, []);
				const attempt = (count) => {
					const result = toggleGitRightbar(ctx);
					if (result.status === "retry") {
						if (count >= 10) {
							pending.current = false;
							setError(result.reason);
							console.error("Git 右侧栏：切换失败", result.reason);
							return;
						}
						timer.current = setTimeout(() => {
							attempt(count + 1);
						}, 60);
						return;
					}
					pending.current = false;
					setError(null);
				};
				const onClick = () => {
					if (pending.current) return;
					pending.current = true;
					setError(null);
					attempt(0);
				};
				return react.createElement("span", { className: "dsm-launchWrap" }, react.createElement("button", {
					type: "button",
					className: "dsm-launch",
					title: "在右侧栏打开或关闭 Git",
					onClick
				}, "Git"), error === null ? null : react.createElement("span", { className: "dsm__error" }, error));
			}
			return GitLauncher;
		}
		/**
		* Register the Git right-column page, its tab type and the header launcher.
		* @param ctx - browser root context carrying the slot registry.
		*/
		function installGitRightbarPage(ctx) {
			const slots = lookup$1(ctx, "slots");
			if (slots === void 0) return;
			const runtime = createGitWindowRuntime();
			const openFullscreen = () => {
				lookup$1(ctx, "layout")?.openRightbar?.(true, true);
			};
			const closeTab = (tabId) => {
				const face = lookup$1(ctx, "sidebarRight");
				if (face === void 0) return;
				const active = face.active();
				const id = tabId ?? (active !== void 0 && active.kind === "git-window" ? active.id : void 0);
				if (id !== void 0) face.close(id);
			};
			const Page = createGitRightbarPage(runtime);
			const Body = (props) => react.createElement(Page, {
				...props,
				openFullscreen,
				closeTab
			});
			ctx.effect(() => slots.inject("sidebar.right.pane.tab", () => slots.register({
				name: "sidebar.right.pane.tab",
				key: GIT_RIGHTBAR_TYPE_ID
			}, Body)), "git-window: rightbar tab body");
			ctx.inject(["slots", "sidebarRightTabs"], (scope) => {
				const scopedSlots = lookup$1(scope, "slots");
				const tabs = lookup$1(scope, "sidebarRightTabs");
				if (scopedSlots === void 0 || tabs === void 0) return;
				const claim = createTypeClaimer(tabs);
				scope.effect(claim(GIT_RIGHTBAR_TYPE_ID, GIT_RIGHTBAR_KIND, () => "Git", () => "Git", () => "提交、差异与提交日志"), "git-window: rightbar tab type");
			});
			ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register({
				name: "conversation.session.header.utilities",
				id: GIT_RIGHTBAR_HEADER_ID,
				order: 41,
				label: () => "Git"
			}, createGitLauncher(ctx))), "git-window: header launcher");
		}
		//#endregion
		//#region src/git-workspace/window/index.ts
		/** Sidebar entry id, also the `main` key the panel registers under. */
		const PANEL_ID = "git-workspace";
		/** Read one optional service. */
		function lookup(ctx, name) {
			return ctx.get(name);
		}
		/** Whether the previous page load had this panel open. */
		function panelWasOpen() {
			if (typeof localStorage === "undefined") return false;
			try {
				return localStorage.getItem(PANEL_OPEN_KEY) === "true";
			} catch {
				return false;
			}
		}
		/**
		* Register the Git tool window panel and its sidebar icon.
		* @param ctx - browser root context carrying the slot registry.
		*/
		function installGitWindowPanel(ctx) {
			const slots = lookup(ctx, "slots");
			if (slots === void 0) return;
			const layout = lookup(ctx, "layout");
			ctx.effect(() => slots.inject("sidebar.panellist", () => slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 30,
				label: "Git"
			}, GitPanelIcon)), "git-window: panel icon");
			const Panel = createGitPanel(createGitWindowRuntime());
			ctx.effect(() => slots.inject("main", () => slots.register({
				name: "main",
				key: PANEL_ID
			}, Panel)), "git-window: main panel");
			ctx.effect(() => {
				if (!panelWasOpen() || layout === void 0) return () => void 0;
				const timer = setTimeout(() => {
					try {
						layout.selectPanel(PANEL_ID);
					} catch {}
				}, 0);
				return () => clearTimeout(timer);
			}, "git-window: restore panel");
		}
		//#endregion
		//#region src/skill-catalog/catalog.ts
		/**
		* Whether one view matches a search query.
		* @param view - the skill to test.
		* @param query - already-trimmed, lower-cased query; empty matches everything.
		* @returns whether the name, description, guidance, or path contains the query.
		*/
		function skillMatchesQuery(view, query) {
			if (query === "") return true;
			return [
				view.name,
				view.description,
				view.whenToUse ?? "",
				view.path ?? "",
				view.rootLabel
			].some((field) => field.toLowerCase().includes(query));
		}
		/**
		* Filter a whole catalog for the search box, preserving section order.
		* @param state - successfully read catalog.
		* @param query - raw query text; surrounding whitespace is ignored.
		* @returns the filtered catalog plus the number of skills it kept.
		*/
		function filterCatalog(state, query) {
			const needle = query.trim().toLowerCase();
			if (needle === "") return {
				state,
				count: countCatalog(state)
			};
			const keep = (views) => views.filter((view) => skillMatchesQuery(view, needle));
			const user = keep(state.user);
			const other = keep(state.other);
			const filtered = {
				user,
				projects: state.projects.map((project) => ({
					...project,
					skills: keep(project.skills)
				})),
				other
			};
			return {
				state: filtered,
				count: countCatalog(filtered)
			};
		}
		/**
		* Count every skill in a catalog.
		* @param state - the catalog.
		* @returns the total across the user, project, and other buckets.
		*/
		function countCatalog(state) {
			return state.user.length + state.other.length + state.projects.reduce((total, project) => total + project.skills.length, 0);
		}
		/**
		* Read a successful state out of a route envelope.
		* @param envelope - the parsed response body.
		* @returns the catalog when the envelope is successful.
		* @throws Error carrying the Host failure code and message otherwise.
		*/
		function stateFromEnvelope(envelope) {
			if (envelope.ok !== true) {
				const code = typeof envelope.error?.code === "string" ? envelope.error.code : "internal";
				const message = typeof envelope.error?.message === "string" ? envelope.error.message : "技能目录读取失败";
				throw new Error(`${code}: ${message}`);
			}
			return {
				user: Array.isArray(envelope.user) ? envelope.user : [],
				projects: Array.isArray(envelope.projects) ? envelope.projects : [],
				other: Array.isArray(envelope.other) ? envelope.other : []
			};
		}
		//#endregion
		//#region src/skill-catalog/client.ts
		/** Route family shared with the Host half. */
		const ROUTE = "/plugin-skill-catalog";
		/** Skills page copy; the plugin is Chinese-first like its other seats. */
		const COPY = {
			title: "技能",
			description: "用户级技能对所有项目生效；项目级技能只在所属项目的目录里生效。技能名可以直接用 /名称 调用。",
			searchPlaceholder: "搜索名称、描述或路径",
			refresh: "刷新",
			refreshing: "读取中…",
			loading: "正在读取技能目录…",
			userSection: "用户级",
			userHint: "所有项目可用 · ~/.dsh/skills、~/.agents/skills",
			userEmpty: "还没有用户级技能。把技能目录放到 ~/.dsh/skills/<名称>/SKILL.md 或 ~/.agents/skills/<名称>/SKILL.md，所有项目都会看到它。",
			projectSection: "项目级",
			projectHint: "按项目根目录下的 .dsh/skills、.agents/skills 发现",
			projectEmpty: "还没有注册工作区，所以没有项目级技能可列。",
			groupEmpty: "这个项目还没有自己的技能。在项目根目录下新建 .dsh/skills/<名称>/SKILL.md 即可。",
			otherSection: "内置 / 其他",
			otherHint: "不随项目变化：内置目录、自定义目录或运行时注册的技能",
			expandAll: "全部展开",
			collapseAll: "全部收起",
			expand: "展开",
			collapse: "收起",
			noDescription: "（没有描述）",
			whenToUse: "何时用：",
			noMatch: "没有匹配的技能",
			staleFailure: "本次刷新失败，下面仍是上一次读到的结果。",
			retry: "重试"
		};
		/** One request to the Host route on the page's own origin. */
		async function requestState(signal) {
			const response = await fetch(new URL(`${ROUTE}/state`, document.baseURI), {
				method: "GET",
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			});
			const text = await response.text();
			let body;
			try {
				body = text === "" ? void 0 : JSON.parse(text);
			} catch {
				throw new Error(`Host 返回了无法解析的响应（HTTP ${response.status}）`);
			}
			const envelope = body;
			if (envelope === void 0) throw new Error(`Host 没有返回技能目录（HTTP ${response.status}）`);
			if (response.status !== 200 && envelope.ok !== false) throw new Error(`Host 返回了 HTTP ${response.status}`);
			return stateFromEnvelope(envelope);
		}
		/**
		* Build the page runtime over the running page.
		* @param _ctx - browser root context; the route is same-origin, so no service is read.
		* @returns the runtime the settings page calls.
		*/
		function createSkillCatalogRuntime(_ctx) {
			return { async load(signal) {
				return await requestState(signal);
			} };
		}
		/** Whether an unknown thrown value is the abort of a page-owned request. */
		function isAbortError(error) {
			return typeof error === "object" && error !== null && error.name === "AbortError";
		}
		/** Printable text for an unknown thrown value. */
		function errorText(error) {
			if (error instanceof Error) return error.message;
			if (typeof error === "string") return error;
			return String(error);
		}
		/** Format one ISO timestamp as a local wall-clock time. */
		function formatTime(iso) {
			if (iso === null) return null;
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return null;
			return date.toLocaleTimeString("zh-CN", { hour12: false });
		}
		/** Descriptions longer than this many characters fold to two lines by default. */
		const DESCRIPTION_CLAMP_CHARS = 80;
		/**
		* One skill row: name, source root, invocation limits, description, and path.
		*
		* A long description starts as two clamped lines with a text button; the
		* toggle is a plain text action so rows stay scannable instead of becoming
		* walls of routing prose.
		* @param props - the skill to render.
		* @returns the row element.
		*/
		function SkillRow({ skill }) {
			const [descriptionOpen, setDescriptionOpen] = react.useState(false);
			const description = skill.description === "" ? COPY.noDescription : skill.description;
			const foldable = skill.description.length > DESCRIPTION_CLAMP_CHARS;
			return react.createElement("div", { className: "sk-row" }, react.createElement("div", { className: "sk-rowHead" }, react.createElement("span", { className: "sk-name" }, skill.name), react.createElement("span", { className: "sk-chip" }, skill.rootLabel), skill.modelInvocable ? null : react.createElement("span", { className: "sk-chip sk-chip--warn" }, "仅手动调用"), skill.userInvocable ? null : react.createElement("span", { className: "sk-chip sk-chip--warn" }, "仅模型可用")), react.createElement("div", { className: foldable && !descriptionOpen ? "sk-desc sk-desc--clamp" : "sk-desc" }, description), foldable ? react.createElement("button", {
				type: "button",
				className: "sk-descToggle",
				"aria-expanded": descriptionOpen,
				onClick: () => {
					setDescriptionOpen((previous) => !previous);
				}
			}, descriptionOpen ? COPY.collapse : COPY.expand) : null, skill.whenToUse === void 0 ? null : react.createElement("div", { className: "sk-when" }, COPY.whenToUse, skill.whenToUse), skill.path === void 0 ? null : react.createElement("div", {
				className: "sk-path",
				title: skill.path
			}, skill.path));
		}
		/**
		* One list of skills with stable keys.
		* @param props - the rows to render.
		* @returns the list wrapper.
		*/
		function SkillList({ skills }) {
			return react.createElement("div", { className: "sk-list" }, ...skills.map((skill) => react.createElement(SkillRow, {
				key: `${skill.name}\u0000${skill.path ?? ""}\u0000${skill.source}`,
				skill
			})));
		}
		/** How many collapsed skill names a project summary previews. */
		const PREVIEW_NAMES = 3;
		/**
		* One project group: a disclosure header, its root path, and either the full
		* list or a one-line preview of what is inside.
		* @param props - the group, whether it is open, and the toggle.
		* @returns the project card.
		*/
		function ProjectCard({ project, open, onToggle }) {
			const title = project.workspaceTitles.length === 0 ? project.projectRoot : project.workspaceTitles.join("、");
			const preview = project.skills.slice(0, PREVIEW_NAMES).map((skill) => skill.name).join("、");
			const previewText = project.skills.length > PREVIEW_NAMES ? `${preview} 等 ${project.skills.length} 个` : preview;
			const head = project.error !== void 0 ? react.createElement("div", { className: "sk-projectTitle" }, title) : react.createElement("button", {
				type: "button",
				className: "sk-projectToggle",
				"aria-expanded": open,
				onClick: onToggle
			}, react.createElement("span", {
				className: "sk-chevron",
				"aria-hidden": true
			}, open ? "▾" : "▸"), react.createElement("span", { className: "sk-projectTitle" }, title), react.createElement("span", { className: "sk-count" }, String(project.skills.length)));
			return react.createElement("div", { className: "sk-project" }, head, react.createElement("div", { className: "sk-projectPath" }, project.projectRoot), project.error === void 0 ? open ? react.createElement(SkillList, { skills: project.skills }) : react.createElement("div", { className: "sk-projectPreview" }, previewText) : react.createElement("div", {
				className: "sk-status sk-status--error",
				role: "alert"
			}, react.createElement("div", { className: "sk-statusTitle" }, "读取这个项目的技能失败。"), react.createElement("div", { className: "sk-statusPath" }, project.error)));
		}
		/**
		* The page body: header, search toolbar, and the three layer sections.
		* @param props - catalog, search state, and refresh state.
		* @returns the page element.
		*/
		function SkillCatalogPage(props) {
			const { state, query, onQueryChange, onRefresh, refreshing, updatedAt, staleFailure } = props;
			const [openProjects, setOpenProjects] = react.useState(() => {
				const withSkills = state.projects.filter((project) => project.skills.length > 0);
				const only = withSkills.length === 1 ? withSkills[0] : void 0;
				return new Set(only === void 0 ? [] : [only.projectRoot]);
			});
			const filtered = filterCatalog(state, query);
			const shown = filtered.state;
			const projectCount = shown.projects.reduce((total, project) => total + project.skills.length, 0);
			const updated = formatTime(updatedAt);
			const queryActive = query.trim() !== "";
			const nothingFound = queryActive && filtered.count === 0;
			const populatedProjects = shown.projects.filter((project) => project.skills.length > 0 || project.error !== void 0);
			const emptyProjects = queryActive ? [] : shown.projects.filter((project) => project.skills.length === 0 && project.error === void 0);
			const toggleableProjects = populatedProjects.filter((project) => project.error === void 0);
			const allProjectsOpen = toggleableProjects.length > 0 && toggleableProjects.every((project) => openProjects.has(project.projectRoot));
			const isOpen = (project) => queryActive || openProjects.has(project.projectRoot);
			const toggleProject = (projectRoot) => {
				setOpenProjects((previous) => {
					const next = new Set(previous);
					if (next.has(projectRoot)) next.delete(projectRoot);
					else next.add(projectRoot);
					return next;
				});
			};
			const toggleAllProjects = () => {
				setOpenProjects(allProjectsOpen ? /* @__PURE__ */ new Set() : new Set(toggleableProjects.map((project) => project.projectRoot)));
			};
			return react.createElement("div", { className: "sk-page" }, react.createElement("style", null, CSS), react.createElement("div", { className: "sk-inner" }, react.createElement("header", { className: "sk-head" }, react.createElement("h1", { className: "sk-title" }, COPY.title), react.createElement("p", { className: "sk-desc sk-headDesc" }, COPY.description)), react.createElement("div", { className: "sk-toolbar" }, react.createElement("input", {
				className: "sk-search",
				type: "search",
				value: query,
				placeholder: COPY.searchPlaceholder,
				"aria-label": COPY.searchPlaceholder,
				spellCheck: false,
				onChange: (event) => {
					onQueryChange(event.currentTarget.value);
				}
			}), react.createElement("button", {
				type: "button",
				className: "sk-btn",
				onClick: onRefresh,
				disabled: refreshing
			}, refreshing ? COPY.refreshing : COPY.refresh), updated === null ? null : react.createElement("span", { className: "sk-updated" }, `更新于 ${updated}`)), staleFailure === null ? null : react.createElement("div", {
				className: "sk-status sk-status--warn",
				role: "status"
			}, react.createElement("div", { className: "sk-statusTitle" }, COPY.staleFailure), react.createElement("div", { className: "sk-statusPath" }, staleFailure)), nothingFound ? react.createElement("div", { className: "sk-empty" }, `${COPY.noMatch}：${query.trim()}`) : null, react.createElement("section", { className: "sk-section" }, react.createElement("div", { className: "sk-sectionHead" }, react.createElement("h2", { className: "sk-sectionTitle" }, COPY.userSection), react.createElement("span", { className: "sk-count" }, String(shown.user.length)), react.createElement("span", { className: "sk-sectionHint" }, COPY.userHint)), shown.user.length === 0 ? queryActive ? null : react.createElement("div", { className: "sk-empty" }, COPY.userEmpty) : react.createElement(SkillList, { skills: shown.user })), react.createElement("section", { className: "sk-section" }, react.createElement("div", { className: "sk-sectionHead" }, react.createElement("h2", { className: "sk-sectionTitle" }, COPY.projectSection), react.createElement("span", { className: "sk-count" }, String(projectCount)), react.createElement("span", { className: "sk-sectionHint" }, COPY.projectHint), toggleableProjects.length > 1 && !queryActive ? react.createElement("button", {
				type: "button",
				className: "sk-linkBtn",
				onClick: toggleAllProjects
			}, allProjectsOpen ? COPY.collapseAll : COPY.expandAll) : null), shown.projects.length === 0 ? react.createElement("div", { className: "sk-empty" }, COPY.projectEmpty) : react.createElement("div", { className: "sk-projects" }, ...populatedProjects.map((project) => react.createElement(ProjectCard, {
				key: project.projectRoot,
				project,
				open: isOpen(project),
				onToggle: () => {
					toggleProject(project.projectRoot);
				}
			})), populatedProjects.length === 0 && emptyProjects.length === 0 ? react.createElement("div", { className: "sk-empty" }, COPY.groupEmpty) : null, emptyProjects.length === 0 ? null : react.createElement("details", { className: "sk-more" }, react.createElement("summary", { className: "sk-moreSummary" }, `另有 ${emptyProjects.length} 个项目没有项目级技能`), react.createElement("div", { className: "sk-moreList" }, ...emptyProjects.map((project) => react.createElement("div", {
				className: "sk-moreItem",
				key: project.projectRoot
			}, react.createElement("span", { className: "sk-moreTitle" }, project.workspaceTitles.length === 0 ? project.projectRoot : project.workspaceTitles.join("、")), react.createElement("span", { className: "sk-morePath" }, project.projectRoot)))), react.createElement("div", { className: "sk-moreHint" }, COPY.groupEmpty)))), shown.other.length === 0 ? null : react.createElement("section", { className: "sk-section" }, react.createElement("div", { className: "sk-sectionHead" }, react.createElement("h2", { className: "sk-sectionTitle" }, COPY.otherSection), react.createElement("span", { className: "sk-count" }, String(shown.other.length)), react.createElement("span", { className: "sk-sectionHint" }, COPY.otherHint)), react.createElement(SkillList, { skills: shown.other }))));
		}
		/**
		* Build the Settings section body: fetch on mount, refetch on demand, and
		* render the pure page body once a catalog exists.
		* @param runtime - Host and browser capabilities.
		* @returns a slot component rendering the skills page.
		*/
		function createSkillCatalogSettings(runtime) {
			return function SkillCatalogSettings() {
				const [state, setState] = react.useState(null);
				const [failure, setFailure] = react.useState(null);
				const [staleFailure, setStaleFailure] = react.useState(null);
				const [query, setQuery] = react.useState("");
				const [refreshing, setRefreshing] = react.useState(false);
				const [updatedAt, setUpdatedAt] = react.useState(null);
				const inFlight = react.useRef(null);
				const hasData = react.useRef(false);
				const read = react.useCallback(async () => {
					inFlight.current?.abort();
					const controller = new AbortController();
					inFlight.current = controller;
					setRefreshing(true);
					try {
						const next = await runtime.load(controller.signal);
						if (controller.signal.aborted) return;
						hasData.current = true;
						setState(next);
						setFailure(null);
						setStaleFailure(null);
						setUpdatedAt((/* @__PURE__ */ new Date()).toISOString());
					} catch (error) {
						if (isAbortError(error)) return;
						const message = `技能目录读取失败：${errorText(error)}`;
						if (hasData.current) setStaleFailure(message);
						else setFailure(message);
					} finally {
						if (inFlight.current === controller) {
							inFlight.current = null;
							setRefreshing(false);
						}
					}
				}, []);
				react.useEffect(() => {
					read();
					return () => {
						inFlight.current?.abort();
					};
				}, [read]);
				if (state === null) return react.createElement("div", { className: "sk-page" }, react.createElement("style", null, CSS), react.createElement("div", { className: "sk-inner" }, react.createElement("header", { className: "sk-head" }, react.createElement("h1", { className: "sk-title" }, COPY.title), react.createElement("p", { className: "sk-desc sk-headDesc" }, COPY.description)), failure === null ? react.createElement("div", {
					className: "sk-loading",
					role: "status"
				}, COPY.loading) : react.createElement("div", {
					className: "sk-status sk-status--error",
					role: "alert"
				}, react.createElement("div", { className: "sk-statusTitle" }, failure), react.createElement("div", { className: "sk-statusActions" }, react.createElement("button", {
					type: "button",
					className: "sk-btn",
					onClick: () => {
						read();
					}
				}, COPY.retry)))));
				return react.createElement(SkillCatalogPage, {
					state,
					query,
					onQueryChange: setQuery,
					onRefresh: () => {
						read();
					},
					refreshing,
					updatedAt,
					staleFailure
				});
			};
		}
		/** Component-local stylesheet; every color is a Harness theme token. */
		const CSS = `
.sk-page { box-sizing: border-box; padding: 2px 0 28px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: inherit; }
.sk-page * { box-sizing: border-box; }
.sk-inner { display: flex; flex-direction: column; gap: 16px; max-width: 720px; }
.sk-head { display: flex; flex-direction: column; gap: 4px; }
.sk-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.sk-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.sk-toolbar { display: flex; align-items: center; gap: 8px; }
.sk-search { flex: 1; min-width: 0; height: 32px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
.sk-search::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.7; }
.sk-search:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.sk-btn { flex: none; height: 32px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.sk-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.sk-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sk-btn:disabled { cursor: default; opacity: 0.5; }
.sk-updated { flex: none; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.sk-section { display: flex; flex-direction: column; gap: 8px; }
.sk-sectionHead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.sk-sectionTitle { margin: 0; font-size: 13px; font-weight: 600; }
.sk-count { flex: none; min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; }
.sk-sectionHint { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.sk-linkBtn { flex: none; margin-left: auto; padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px; cursor: pointer; }
.sk-linkBtn:hover { text-decoration: underline; text-underline-offset: 2px; }
.sk-linkBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.sk-list { border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.sk-row { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; }
.sk-row + .sk-row { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.sk-rowHead { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.sk-name { font-size: 14.5px; font-weight: 600; line-height: 1.35; }
.sk-chip { flex: none; padding: 0 6px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 999px; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; line-height: 16px; }
.sk-chip--warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); font-family: inherit; }
.sk-desc { color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.sk-desc--clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.sk-descToggle { align-self: flex-start; padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 11.5px; line-height: 1.4; cursor: pointer; }
.sk-descToggle:hover { text-decoration: underline; text-underline-offset: 2px; }
.sk-descToggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.sk-when { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.sk-path { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.sk-projects { display: flex; flex-direction: column; gap: 10px; }
.sk-project { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.sk-projectToggle { display: flex; align-items: center; gap: 6px; width: 100%; padding: 0; margin: 0; border: 0; background: none; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
.sk-projectToggle:hover .sk-projectTitle { text-decoration: underline; text-underline-offset: 2px; }
.sk-projectToggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.sk-chevron { flex: none; width: 10px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1; }
.sk-projectTitle { font-size: 14.5px; font-weight: 600; line-height: 1.35; }
.sk-projectPreview { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-projectPath { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.sk-more { padding: 8px 12px; border: 0.5px dashed var(--dsw-alias-border-l1); border-radius: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sk-moreSummary { cursor: pointer; }
.sk-moreSummary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sk-more[open] .sk-moreSummary { margin-bottom: 6px; }
.sk-moreList { display: flex; flex-direction: column; gap: 2px; padding: 2px 0 6px; }
.sk-moreItem { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.sk-moreTitle { color: var(--dsw-alias-label-primary); font-size: 12px; }
.sk-morePath { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.sk-moreHint { font-size: 11.5px; }
.sk-empty { padding: 12px; border: 0.5px dashed var(--dsw-alias-border-l1); border-radius: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sk-loading { color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.sk-status { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
.sk-statusTitle { font-weight: 500; }
.sk-status--warn { border-color: var(--dsw-alias-state-warn-primary); }
.sk-status--warn .sk-statusTitle { color: var(--dsw-alias-state-warn-primary); }
.sk-status--error { border-color: var(--dsw-alias-state-error-primary); }
.sk-status--error .sk-statusTitle { color: var(--dsw-alias-state-error-primary); }
.sk-statusPath { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.sk-statusActions { display: flex; gap: 8px; padding-top: 2px; }
`;
		//#endregion
		//#region src/session-map/graph.ts
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
		* @module dsh-session-map/session-map/graph
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
		//#region src/session-map/views.ts
		/**
		* The three View bodies: the plain Session overview (Conversation tab and
		* right-column tab), the launcher button, and the turn-tree canvas factory.
		*
		* They receive everything through their composed props and a {@link
		* SessionMapRuntime}; `ctx` never crosses this boundary, so a body can be
		* rendered by a test or by the slot renderer without a runtime.
		*
		* @module dsh-session-map/session-map/views
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
						setError(errorText$3(cause));
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
						const message = errorText$3(cause);
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
							const delta = -event.deltaY * unit;
							const factor = clampNumber(Math.pow(WHEEL_ZOOM_BASE, Math.sign(delta) * Math.max(Math.abs(delta), 1)), 1 / WHEEL_ZOOM_MAX_STEP, WHEEL_ZOOM_MAX_STEP);
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
						setError(errorText$3(cause));
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
		//#region src/session-map/index.ts
		/** Plugin name the Loader reports for this bundle's browser half. */
		const name = "@xiguazhiprince/dsh-session-map";
		/** Hard dependency: there is nothing to register into before the slot registry exists. */
		const inject = ["slots"];
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
			const slots = lookup$1(ctx, "slots");
			if (slots === void 0) return;
			installGitWindowPanel(ctx);
			installGitRightbarPage(ctx);
			ctx.effect(() => {
				const element = document.createElement("style");
				element.textContent = CSS$3;
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
					const service = lookup$1(ctx, "sidebarRight");
					if (service === void 0) throw new Error("右侧栏服务 sidebarRight 不可用");
					return service;
				},
				openSession: (sessionId) => {
					const uiWorkspace = lookup$1(ctx, "uiWorkspace");
					if (uiWorkspace !== void 0 && typeof uiWorkspace.openSession === "function") {
						uiWorkspace.openSession(sessionId);
						return;
					}
					const sessions = lookup$1(ctx, "sessions");
					if (sessions !== void 0 && typeof sessions.open === "function") sessions.open(sessionId);
				},
				sessions: () => lookup$1(ctx, "sessions")
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
			const GitWorkspaceSettings = createGitWorkspaceSettings(createGitWorkspaceRuntime(ctx));
			ctx.effect(() => slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "git-workspace",
				order: 60,
				label: "从 Git 克隆"
			}, GitWorkspaceSettings)), "git-workspace: settings section");
			const SkillCatalogSettings = createSkillCatalogSettings(createSkillCatalogRuntime(ctx));
			ctx.effect(() => slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "skills",
				order: 30,
				label: "技能"
			}, SkillCatalogSettings)), "skill-catalog: settings section");
			ctx.inject([
				"slots",
				"remote",
				"remote.workspaceFiles"
			], (scope) => {
				const scopedSlots = lookup$1(scope, "slots");
				const remote = lookup$1(scope, "remote");
				if (scopedSlots === void 0 || remote === void 0) return;
				const GitBranchBadge = createGitBranchBadge(remote);
				scope.effect(() => scopedSlots.inject("conversation.input.left", () => scopedSlots.register({
					name: "conversation.input.left",
					id: "session-map-git-branch",
					order: 10
				}, GitBranchBadge)), "session-map: git branch badge");
			});
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
				const scopedSlots = lookup$1(scope, "slots");
				const sidebarRightTabs = lookup$1(scope, "sidebarRightTabs");
				if (scopedSlots === void 0 || sidebarRightTabs === void 0) return;
				const claimType = createTypeClaimer(sidebarRightTabs);
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