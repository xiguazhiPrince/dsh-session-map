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
		//#region src/client/acp-model.ts
		/** The vendor presets this page offers. */
		const ACP_VENDORS = [
			{
				id: "cursor",
				label: "Cursor CLI",
				command: "cursor-agent",
				args: "acp",
				docs: "https://cursor.com/docs/cli/acp",
				note: "新版安装也可能只提供 agent，两个名字都能解析；首次使用先在终端登录。"
			},
			{
				id: "opencode",
				label: "opencode",
				command: "opencode",
				args: "acp",
				docs: "https://opencode.ai/docs/acp"
			},
			{
				id: "gemini",
				label: "Gemini CLI",
				command: "gemini",
				args: "--acp",
				docs: "https://geminicli.com/docs/cli/acp-mode/",
				note: "Gemini CLI 已于 2026-06-18 由 Antigravity CLI 取代，仍可用但需自行确认。"
			}
		];
		/** The shipped row id, used when the schema marker is absent (a renamed or re-inserted row). */
		const KNOWN_ENTRY_ID = "acp-agent";
		/** Agent names address the model route and seed a preset card id. */
		const AGENT_NAME = /^[A-Za-z0-9._-]+$/;
		/** Absolute-path shapes the Host accepts for `cwd`: a drive root, a UNC root, or a POSIX root. */
		const ABSOLUTE_CWD = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
		/**
		* A new, empty agent draft.
		* @returns the draft.
		*/
		function emptyAgent() {
			return {
				name: "",
				command: "",
				args: "acp",
				mode: "",
				permission: "allow",
				cwd: "",
				env: "",
				configOptions: "",
				enabled: true
			};
		}
		/**
		* Pick a name not already used by another draft.
		* @param base - the preferred stem.
		* @param taken - names already in use.
		* @returns `base`, or `base-2`, `base-3`, … until one is free.
		*/
		function uniqueName(base, taken) {
			const used = new Set(taken.map((name) => name.trim()));
			if (!used.has(base)) return base;
			for (let suffix = 2; suffix < 1e3; suffix += 1) {
				const candidate = `${base}-${String(suffix)}`;
				if (!used.has(candidate)) return candidate;
			}
			return `${base}-${String(Date.now())}`;
		}
		/**
		* A draft pre-filled from one vendor preset, named so it cannot collide with an
		* agent the page is already showing.
		* @param vendor - the preset.
		* @param existing - the drafts currently in the list.
		* @returns the draft.
		*/
		function vendorAgent(vendor, existing) {
			return {
				...emptyAgent(),
				name: uniqueName(vendor.id, existing.map((draft) => draft.name)),
				command: vendor.command,
				args: vendor.args
			};
		}
		/**
		* Read a string field, treating anything else as absent.
		* @param value - the stored value.
		* @returns the text, or `''`.
		*/
		function text(value) {
			return typeof value === "string" ? value : "";
		}
		/**
		* Format a scalar map as `KEY=VALUE` lines.
		* @param value - the map as stored.
		* @returns the textarea text.
		*/
		function formatPairs(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
			return Object.entries(value).map(([key, entry]) => `${key}=${String(entry)}`).join("\n");
		}
		/**
		* Parse `KEY=VALUE` lines.
		* @param source - the textarea text.
		* @returns the parsed map, or the first problem found.
		*/
		function parsePairs(source) {
			const value = {};
			for (const [number, rawLine] of source.split("\n").entries()) {
				const line = rawLine.trim();
				if (line === "" || line.startsWith("#")) continue;
				const separator = line.indexOf("=");
				if (separator <= 0) return {
					ok: false,
					message: `第 ${number + 1} 行不是 KEY=VALUE`
				};
				const key = line.slice(0, separator).trim();
				if (key === "") return {
					ok: false,
					message: `第 ${number + 1} 行缺少键名`
				};
				if (Object.hasOwn(value, key)) return {
					ok: false,
					message: `第 ${number + 1} 行的键 ${key} 重复`
				};
				value[key] = line.slice(separator + 1).trim();
			}
			return {
				ok: true,
				value
			};
		}
		/**
		* Split an argument line the way a shell user expects, honouring double quotes.
		*
		* The Host never interprets a shell, so this is not a shell parser: it is the
		* one convention the page documents (space-separated, double quotes for a token
		* that contains a space).
		* @param source - the argument text.
		* @returns the argv tail.
		*/
		function parseArgs$1(source) {
			const tokens = [];
			let current = "";
			let quoted = false;
			let started = false;
			for (const character of source) {
				if (character === "\"") {
					quoted = !quoted;
					started = true;
					continue;
				}
				if (!quoted && /\s/.test(character)) {
					if (started) tokens.push(current);
					current = "";
					started = false;
					continue;
				}
				current += character;
				started = true;
			}
			if (started) tokens.push(current);
			return tokens;
		}
		/**
		* Convert one stored agent into a draft.
		* @param raw - the stored agent.
		* @returns the draft.
		*/
		function draftFromWire(raw) {
			const record = raw ?? {};
			const args = record["args"];
			return {
				name: text(record["name"]),
				command: text(record["command"]),
				args: Array.isArray(args) ? args.map(String).join(" ") : args === void 0 ? "" : String(args),
				mode: text(record["mode"]),
				permission: record["permission"] === "reject" ? "reject" : "allow",
				cwd: text(record["cwd"]),
				env: formatPairs(record["env"]),
				configOptions: formatPairs(record["configOptions"]),
				enabled: record["enabled"] !== false
			};
		}
		/**
		* Read the stored agent list.
		* @param value - the namespace value from the settings mirror.
		* @returns the drafts, and any problem reading one of them.
		*/
		function draftsFromValue(value) {
			const agents = value ?? {};
			if (!Array.isArray(agents.agents)) return {
				drafts: [],
				problems: []
			};
			const drafts = [];
			const problems = [];
			for (const [index, raw] of agents.agents.entries()) {
				if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
					problems.push({
						index,
						message: "这一项不是有效的 agent 配置"
					});
					continue;
				}
				drafts.push(draftFromWire(raw));
			}
			return {
				drafts,
				problems
			};
		}
		/**
		* Validate the whole draft list: the rules the backend enforces, surfaced before
		* a write rather than as a Host refusal. The Host drops a disabled agent only
		* after parsing it, so nothing here is conditional on `enabled`.
		* @param drafts - the drafts to check.
		* @returns every problem found, in draft order.
		*/
		function validateDrafts(drafts) {
			const problems = [];
			const seen = /* @__PURE__ */ new Map();
			for (const [index, draft] of drafts.entries()) {
				const name = draft.name.trim();
				if (name === "") problems.push({
					index,
					message: "名称必填（它就是 acp 路由上的模型 id）"
				});
				else if (!AGENT_NAME.test(name)) problems.push({
					index,
					message: "名称只能用字母、数字、点、下划线、连字符"
				});
				else if (seen.has(name)) problems.push({
					index,
					message: `名称与第 ${(seen.get(name) ?? 0) + 1} 个 agent 重复`
				});
				else seen.set(name, index);
				if (draft.command.trim() === "") problems.push({
					index,
					message: "命令必填（CLI 名字或可执行文件路径）"
				});
				const cwd = draft.cwd.trim();
				if (cwd !== "" && !ABSOLUTE_CWD.test(cwd)) problems.push({
					index,
					message: "工作目录要写绝对路径"
				});
				const env = parsePairs(draft.env);
				if (!env.ok) problems.push({
					index,
					message: `环境变量：${env.message}`
				});
				const options = parsePairs(draft.configOptions);
				if (!options.ok) problems.push({
					index,
					message: `会话选项：${options.message}`
				});
			}
			return problems;
		}
		/**
		* Convert the drafts back to the stored shape, dropping empty optional fields
		* and every default so the patch stays readable.
		* @param drafts - the drafts to persist.
		* @returns the `agents` value, or the problems that make them unwritable.
		*/
		function valueFromDrafts(drafts) {
			const problems = validateDrafts(drafts);
			if (problems.length > 0) return {
				ok: false,
				problems
			};
			return {
				ok: true,
				value: drafts.map((draft) => {
					const agent = {
						name: draft.name.trim(),
						command: draft.command.trim()
					};
					const args = parseArgs$1(draft.args);
					if (args.length > 0 && !(args.length === 1 && args[0] === "acp")) agent["args"] = args;
					if (draft.mode.trim() !== "") agent["mode"] = draft.mode.trim();
					if (draft.permission === "reject") agent["permission"] = "reject";
					if (draft.cwd.trim() !== "") agent["cwd"] = draft.cwd.trim();
					const env = parsePairs(draft.env);
					if (env.ok && Object.keys(env.value).length > 0) agent["env"] = env.value;
					const options = parsePairs(draft.configOptions);
					if (options.ok && Object.keys(options.value).length > 0) agent["configOptions"] = options.value;
					if (!draft.enabled) agent["enabled"] = false;
					return agent;
				})
			};
		}
		/**
		* Append a new agent.
		* @param drafts - the current drafts.
		* @returns the new list.
		*/
		function addAgent(drafts) {
			return [...drafts, emptyAgent()];
		}
		/**
		* Remove one agent.
		* @param drafts - the current drafts.
		* @param index - the agent to drop.
		* @returns the new list.
		*/
		function removeAgent(drafts, index) {
			return drafts.filter((_, position) => position !== index);
		}
		/**
		* Move one agent by one position.
		* @param drafts - the current drafts.
		* @param index - the agent to move.
		* @param delta - `-1` towards the front, `1` towards the back.
		* @returns the new list, unchanged when the move would fall off an end.
		*/
		function moveAgent(drafts, index, delta) {
			const target = index + delta;
			if (target < 0 || target >= drafts.length) return [...drafts];
			const next = [...drafts];
			const [moved] = next.splice(index, 1);
			next.splice(target, 0, moved);
			return next;
		}
		/**
		* Apply a field change to one agent.
		* @param drafts - the current drafts.
		* @param index - the agent to change.
		* @param patch - the fields to replace.
		* @returns the new list.
		*/
		function patchAgent(drafts, index, patch) {
			return drafts.map((draft, position) => position === index ? {
				...draft,
				...patch
			} : draft);
		}
		/**
		* Resolve one node of a schemastery `toJSON()` ref graph.
		* @param schema - the serialized schema envelope.
		* @param uid - the node reference to follow.
		* @returns the node, or undefined when the graph has no such reference.
		*/
		function resolveSchemaNode(schema, uid) {
			if (schema === null || typeof schema !== "object") return void 0;
			const node = schema.refs?.[String(uid)];
			return node !== null && typeof node === "object" ? node : void 0;
		}
		/**
		* Whether one namespace's schema is this plugin's agent list.
		*
		* The Host does not report which plugin owns a namespace, so a page that must
		* find its own entry identifies the schema instead: an `agents` array whose
		* items declare `name` and `command`. Matching on shape rather than on a
		* hard-coded row id also means a profile that renamed or re-inserted the row
		* still gets its page.
		* @param view - the namespace view.
		* @returns true when the schema is the ACP route's.
		*/
		function isAcpNamespace(view) {
			const graph = view.schema;
			const dict = resolveSchemaNode(view.schema, graph?.uid)?.["dict"];
			const agents = resolveSchemaNode(view.schema, dict?.["agents"]);
			if (agents?.["type"] !== "array") return false;
			const itemDict = resolveSchemaNode(view.schema, agents["inner"])?.["dict"];
			return itemDict !== void 0 && itemDict["name"] !== void 0 && itemDict["command"] !== void 0;
		}
		/**
		* Choose the namespace this page edits.
		* @param namespaces - every namespace the Host serves.
		* @param fallbackId - the shipped row id, used when the schema marker is absent.
		* @returns the namespace id, or `undefined` when the Host serves none of ours.
		*/
		function selectAcpNamespace(namespaces, fallbackId) {
			return namespaces.find(isAcpNamespace)?.ns ?? namespaces.find((view) => view.ns === fallbackId)?.ns;
		}
		//#endregion
		//#region src/client/acp-card.ts
		/**
		* The ACP 供应商 settings page: the page that makes the ACP route configurable
		* without editing a profile patch.
		*
		* The page edits ONE field — the `agents` list of the `acp-agent` row — through
		* the settings domain's shared configuration form, which persists into the
		* active profile's Cordis patch and fences every write with the namespace
		* revision. It registers as a `settings.section` page, because the settings
		* shell is where a person looks for it; the entry is chosen by schema shape
		* rather than by row id (see `selectAcpNamespace`).
		*
		* It is written with `createElement` and this plugin's own classes: the product's
		* browser packages are prerelease, so this repository pins none of them and
		* imports none of them. The page therefore closes over the service handles that
		* `apply` looked up, instead of receiving injected props.
		*
		* @module dsh-session-map/client/acp-card
		*/
		/**
		* Subscribe one component to a snapshot source.
		* @param source - the store.
		* @returns the current snapshot, re-rendering on change.
		*/
		function useSnapshot(source) {
			const [snapshot, setSnapshot] = (0, react.useState)(() => source.getSnapshot());
			(0, react.useEffect)(() => {
				setSnapshot(() => source.getSnapshot());
				return source.subscribe(() => {
					setSnapshot(() => source.getSnapshot());
				});
			}, [source]);
			return snapshot;
		}
		/** A form-shaped placeholder so the hook order never depends on discovery. */
		const EMPTY_FORM = {
			getSnapshot: () => ({
				status: "loading",
				value: void 0,
				writable: false,
				mode: "host"
			}),
			subscribe: () => () => {},
			set: async () => false
		};
		/**
		* Build the page component over a fixed configuration-form service.
		* @param forms - the shared configuration-form service.
		* @returns the settings-section component.
		*/
		function createAcpCard(forms) {
			return function AcpVendorsCard() {
				const mirror = useSnapshot((0, react.useMemo)(() => forms.describe(), [forms]));
				const namespace = selectAcpNamespace(mirror.view?.namespaces ?? [], KNOWN_ENTRY_ID);
				const form = (0, react.useMemo)(() => namespace === void 0 ? void 0 : forms.get(namespace), [forms, namespace]);
				const snapshot = useSnapshot(form ?? EMPTY_FORM);
				const [state, setState] = (0, react.useState)(() => ({
					drafts: [],
					problems: [],
					dirty: false,
					saving: false,
					failure: null
				}));
				const served = snapshot.value;
				(0, react.useEffect)(() => {
					if (form === void 0) return;
					setState((current) => {
						if (current.dirty) return current;
						const { drafts } = draftsFromValue(served);
						return {
							...current,
							drafts,
							problems: validateDrafts(drafts)
						};
					});
				}, [form, served]);
				const edit = (0, react.useCallback)((next) => {
					setState((current) => ({
						...current,
						drafts: next,
						problems: validateDrafts(next),
						dirty: true,
						failure: null
					}));
				}, []);
				const save = (0, react.useCallback)(async () => {
					if (form === void 0) return;
					const written = valueFromDrafts(state.drafts);
					if (!written.ok) {
						setState((current) => ({
							...current,
							problems: written.problems
						}));
						return;
					}
					setState((current) => ({
						...current,
						saving: true,
						failure: null
					}));
					try {
						const accepted = await form.set("agents", written.value);
						setState((current) => accepted ? {
							...current,
							problems: [],
							dirty: false,
							saving: false,
							failure: null
						} : {
							...current,
							saving: false,
							failure: "Host 拒绝了这次写入（按卡片上的提示改完再保存）"
						});
					} catch (error) {
						setState((current) => ({
							...current,
							saving: false,
							failure: `写入失败：${error instanceof Error ? error.message : String(error)}`
						}));
					}
				}, [form, state.drafts]);
				const discard = (0, react.useCallback)(() => {
					const { drafts } = draftsFromValue(served);
					setState((current) => ({
						...current,
						drafts,
						problems: validateDrafts(drafts),
						dirty: false,
						failure: null
					}));
				}, [served]);
				const loading = mirror.view === void 0;
				const unavailable = !loading && (namespace === void 0 || snapshot.status === "unavailable");
				const readOnly = snapshot.writable !== true || snapshot.mode === "memory";
				const servedPage = !loading && !unavailable;
				return (0, react.createElement)("section", { className: "dsm-acp-page" }, (0, react.createElement)("h2", { className: "dsm-acp-page__title" }, "ACP 供应商"), (0, react.createElement)("p", { className: "dsm-acp-page__note" }, "这里配置的 agent 会成为 acp 路由上的一个模型，并在新会话的预设卡片里出现一张卡。保存后立即生效，不用重启，也不用改配置文件。"), (0, react.createElement)("p", { className: "dsm-acp-page__warn" }, "permission: allow 意味着远端 agent 的工具无人干预地跑，它能在会话工作目录里写文件。要收紧就把这一项换成 reject，或在 profile 里把 approval 设成 ask（approval / fs / 回收时间这些行级字段仍只在 cordis.patch.yml 里）。"), (0, react.createElement)("p", { className: "dsm-acp-page__note" }, "各家文档：", ...ACP_VENDORS.map((vendor, index) => (0, react.createElement)("span", { key: vendor.id }, index === 0 ? null : " · ", (0, react.createElement)("a", {
					className: "dsm-acp-page__link",
					href: vendor.docs,
					target: "_blank",
					rel: "noreferrer"
				}, vendor.label)))), loading ? (0, react.createElement)("p", { className: "dsm-acp-page__empty" }, "读取中…") : null, unavailable ? (0, react.createElement)("p", { className: "dsm-acp-page__empty" }, "当前 Host 没有加载 ACP 组件（acp-agent 那一行没打开，或者被禁用了）。在 profile 的 cordis.patch.yml 里把这一行的 disabled 去掉（或改成 false），重载后回到这个页面。") : null, servedPage && readOnly ? (0, react.createElement)("p", { className: "dsm-acp-page__empty" }, "当前 Host 不接受写入（只有本机页面可以写），这里只能查看。") : null, servedPage ? (0, react.createElement)("div", { className: "dsm-acp-page__presets" }, (0, react.createElement)("span", { className: "dsm-acp-page__presetLabel" }, "添加："), ...ACP_VENDORS.map((vendor) => (0, react.createElement)("button", {
					key: vendor.id,
					type: "button",
					className: "dsm-acp-page__button",
					title: vendor.note === void 0 ? vendor.docs : `${vendor.note}（${vendor.docs}）`,
					disabled: readOnly,
					onClick: () => {
						edit([...state.drafts, vendorAgent(vendor, state.drafts)]);
					}
				}, `+ ${vendor.label}`)), (0, react.createElement)("button", {
					type: "button",
					className: "dsm-acp-page__button",
					disabled: readOnly,
					onClick: () => {
						edit(addAgent(state.drafts));
					}
				}, "+ 自定义")) : null, servedPage ? (0, react.createElement)("ul", { className: "dsm-acp-page__list" }, ...state.drafts.map((draft, index) => renderAgent(draft, index, state, edit, readOnly))) : null, servedPage ? (0, react.createElement)("div", { className: "dsm-acp-page__actions" }, (0, react.createElement)("button", {
					type: "button",
					className: "dsm-acp-page__button dsm-acp-page__button--primary",
					disabled: readOnly || !state.dirty || state.saving || state.problems.length > 0,
					onClick: () => {
						save();
					}
				}, state.saving ? "保存中…" : "保存"), (0, react.createElement)("button", {
					type: "button",
					className: "dsm-acp-page__button",
					disabled: readOnly || !state.dirty || state.saving,
					onClick: discard
				}, "放弃修改"), state.dirty && state.problems.length === 0 ? (0, react.createElement)("span", { className: "dsm-acp-page__dirty" }, "有未保存的修改") : null) : null, state.failure === null ? null : (0, react.createElement)("p", { className: "dsm-acp-page__error" }, state.failure), !servedPage || state.drafts.length > 0 ? null : (0, react.createElement)("p", { className: "dsm-acp-page__empty" }, "还没有 agent。点上面的「+ Cursor」或「+ 自定义」，填上 CLI 名字就行。"));
			};
		}
		/**
		* Render one agent card.
		* @param draft - the agent's draft.
		* @param index - its position.
		* @param state - the page state, for problems.
		* @param edit - applies a whole new draft list.
		* @param readOnly - whether writes are available.
		* @returns the card element.
		*/
		function renderAgent(draft, index, state, edit, readOnly) {
			const problems = state.problems.filter((problem) => problem.index === index);
			const field = (key, label, placeholder) => (0, react.createElement)("label", { className: "dsm-acp-page__field" }, (0, react.createElement)("span", { className: "dsm-acp-page__label" }, label), (0, react.createElement)("input", {
				type: "text",
				className: "dsm-acp-page__input",
				value: String(draft[key]),
				placeholder,
				disabled: readOnly,
				onChange: (event) => {
					edit(patchAgent(state.drafts, index, { [key]: event.target.value }));
				}
			}));
			return (0, react.createElement)("li", {
				className: draft.enabled ? "dsm-acp-page__agent" : "dsm-acp-page__agent dsm-acp-page__agent--off",
				key: `${String(index)}-${draft.name}`
			}, (0, react.createElement)("div", { className: "dsm-acp-page__agentHead" }, (0, react.createElement)("span", { className: "dsm-acp-page__name" }, draft.name.trim() === "" ? `agent ${String(index + 1)}` : draft.name), (0, react.createElement)("span", { className: "dsm-acp-page__chip dsm-acp-page__chip--on" }, draft.enabled ? "已启用" : "已停用"), (0, react.createElement)("span", { className: "dsm-acp-page__chip" }, draft.permission === "reject" ? "一律拒绝权限" : "自动批准权限"), (0, react.createElement)("span", { className: "dsm-acp-page__spacer" }), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-acp-page__button",
				disabled: readOnly || index === 0,
				onClick: () => {
					edit(moveAgent(state.drafts, index, -1));
				}
			}, "上移"), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-acp-page__button",
				disabled: readOnly || index === state.drafts.length - 1,
				onClick: () => {
					edit(moveAgent(state.drafts, index, 1));
				}
			}, "下移"), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-acp-page__button dsm-acp-page__button--danger",
				disabled: readOnly,
				onClick: () => {
					edit(removeAgent(state.drafts, index));
				}
			}, "删除")), (0, react.createElement)("div", { className: "dsm-acp-page__grid" }, field("name", "名称", "cursor"), field("command", "命令", "cursor-agent 或 C:\\path\\to\\agent.exe"), field("args", "参数", "acp"), field("mode", "模式（可留空）", "agent / plan / ask")), (0, react.createElement)("div", { className: "dsm-acp-page__grid" }, (0, react.createElement)("label", { className: "dsm-acp-page__field" }, (0, react.createElement)("span", { className: "dsm-acp-page__label" }, "权限"), (0, react.createElement)("select", {
				className: "dsm-acp-page__input",
				value: draft.permission,
				disabled: readOnly,
				onChange: (event) => {
					edit(patchAgent(state.drafts, index, { permission: event.target.value === "reject" ? "reject" : "allow" }));
				}
			}, (0, react.createElement)("option", { value: "allow" }, "allow —— 自动批准 agent 的权限请求"), (0, react.createElement)("option", { value: "reject" }, "reject —— 一律拒绝（配合只读模式）"))), field("cwd", "工作目录（可留空）", "默认用会话自己的工作目录"), (0, react.createElement)("label", { className: "dsm-acp-page__field dsm-acp-page__check" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: draft.enabled,
				disabled: readOnly,
				onChange: (event) => {
					edit(patchAgent(state.drafts, index, { enabled: event.target.checked }));
				}
			}), (0, react.createElement)("span", { className: "dsm-acp-page__label" }, "启用这个 agent"))), (0, react.createElement)("details", { className: "dsm-acp-page__more" }, (0, react.createElement)("summary", null, "环境变量与会话选项"), (0, react.createElement)("div", { className: "dsm-acp-page__grid" }, textarea("env", "环境变量（每行 KEY=VALUE）", draft, index, state.drafts, edit, readOnly), textarea("configOptions", "会话选项（每行 KEY=VALUE，例如 model=…）", draft, index, state.drafts, edit, readOnly))), problems.length === 0 ? null : (0, react.createElement)("ul", { className: "dsm-acp-page__problems" }, ...problems.map((problem) => (0, react.createElement)("li", { key: problem.message }, problem.message))));
		}
		/**
		* Render one `KEY=VALUE` textarea.
		* @param key - the draft field it edits.
		* @param label - its label.
		* @param draft - the agent's draft.
		* @param index - its position.
		* @param drafts - the whole draft list the edit replaces.
		* @param edit - applies a whole new draft list.
		* @param readOnly - whether writes are available.
		* @returns the field element.
		*/
		function textarea(key, label, draft, index, drafts, edit, readOnly) {
			return (0, react.createElement)("label", { className: "dsm-acp-page__field dsm-acp-page__wide" }, (0, react.createElement)("span", { className: "dsm-acp-page__label" }, label), (0, react.createElement)("textarea", {
				className: "dsm-acp-page__input",
				rows: 3,
				value: draft[key],
				disabled: readOnly,
				onChange: (event) => {
					edit(patchAgent(drafts, index, { [key]: event.target.value }));
				}
			}));
		}
		//#endregion
		//#region src/client/acp-tool-row.ts
		/**
		* The Tool row this plugin claims for its own mirrored ACP calls.
		*
		* Why this exists at all is worth stating, because it corrects an assumption
		* made when the mirrored calls were first emitted. A tool's host-side
		* `presentCall` does NOT reach this card: the browser builds a tool row from
		* `toolTitleKey(toolName)` — a fixed locale-key table — and a summary derived
		* from the raw arguments, so an unknown wire name falls to the generic title and
		* the row reads `acp_read · session-…::cursor#3`. The only place a plugin can
		* change that is the keyed `tool.call.toolview` slot, whose key domain is open by
		* contract ("Any name is allowed, including tools registered by your package").
		*
		* So this view renders the remote agent's own words: its title for the call, the
		* category it reported, and the file it touched. It is drawn with `createElement`
		* and this plugin's own classes because the product's row primitives are not
		* importable from a standalone package; the styling rides the same theme tokens
		* the rest of this plugin uses.
		*
		* @module dsh-session-map/client/acp-tool-row
		*/
		/**
		* The wire names the ACP route registers, one per ACP tool kind. Kept in step
		* with `acp-agent/channel.ts`'s `TOOL_KINDS` by hand: the two halves are built
		* for different runtimes and share no module.
		*/
		const ACP_TOOL_KEYS = [
			"acp_read",
			"acp_edit",
			"acp_delete",
			"acp_move",
			"acp_search",
			"acp_execute",
			"acp_think",
			"acp_fetch",
			"acp_switch_mode",
			"acp_other"
		];
		/**
		* Category labels. Hard-coded Chinese, like every other string this plugin
		* ships; the locale service would add a namespace and a dictionary per language
		* for ten short words.
		*/
		const KIND_LABELS = {
			read: "读取",
			edit: "编辑",
			delete: "删除",
			move: "移动",
			search: "搜索",
			execute: "执行",
			think: "思考",
			fetch: "获取",
			switch_mode: "切换模式",
			other: "工具"
		};
		/**
		* Read the call's raw argument JSON for whichever stage this render is in.
		* @param props - the owner currency.
		* @returns the JSON text, or `''` before arguments exist.
		*/
		function argsRawOf(props) {
			if (props.phase === "start") return typeof props.block["argsRaw"] === "string" ? props.block["argsRaw"] : "";
			if (props.phase === "result") {
				const call = props.block["call"];
				return typeof call?.argsRaw === "string" ? call.argsRaw : "";
			}
			return "";
		}
		/**
		* Parse the argument JSON, tolerating anything. A malformed payload must render
		* as a plain row, never as a crash inside the conversation.
		* @param raw - the argument JSON text.
		* @returns the parsed arguments, or an empty object.
		*/
		function parseArgs(raw) {
			if (raw === "") return {};
			try {
				const parsed = JSON.parse(raw);
				return parsed !== null && typeof parsed === "object" ? parsed : {};
			} catch {
				return {};
			}
		}
		/**
		* The settled result's text, if it has any.
		* @param props - the owner currency.
		* @returns the joined text, or undefined while running or when blank.
		*/
		function resultText(props) {
			if (props.phase !== "result") return void 0;
			const content = props.block["content"];
			if (!Array.isArray(content)) return void 0;
			const text = content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n").trim();
			return text === "" ? void 0 : text;
		}
		/**
		* Shorten a workspace-rooted path, so a card shows what the reader recognizes.
		* @param path - the reported path.
		* @param cwd - the session workspace root, when known.
		* @returns the path relative to the workspace, or unchanged.
		*/
		function displayPath(path, cwd) {
			if (cwd === void 0 || cwd === "") return path;
			const normalized = path.replace(/\\/g, "/");
			const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
			return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : path;
		}
		/**
		* One mirrored ACP tool call.
		* @param props - the Tool slot's owner currency.
		* @returns the row.
		*/
		function AcpToolRow(props) {
			const { expanded, toggle } = props.useDisclosure();
			const args = parseArgs(argsRawOf(props));
			const kind = typeof args.kind === "string" && args.kind !== "" ? args.kind : "other";
			const label = KIND_LABELS[kind] ?? KIND_LABELS["other"];
			const remoteTitle = typeof args.title === "string" && args.title.trim() !== "" ? args.title : void 0;
			const location = Array.isArray(args.locations) && args.locations.length > 0 ? args.locations[0] : void 0;
			const path = location === void 0 ? void 0 : displayPath(location.path, props.cwd);
			const output = resultText(props);
			const failed = props.phase === "result" && props.block["isError"] === true;
			const state = props.phase === "preparing" ? "preparing" : props.phase === "start" ? "running" : failed ? "error" : "ok";
			const headline = remoteTitle ?? path ?? props.callId;
			const head = [
				(0, react.createElement)("span", {
					key: "dot",
					className: "dsm-acp-tool__dot",
					"data-state": state
				}),
				(0, react.createElement)("span", {
					key: "kind",
					className: "dsm-acp-tool__kind"
				}, label),
				(0, react.createElement)("span", {
					key: "headline",
					className: "dsm-acp-tool__headline",
					title: headline
				}, headline)
			];
			if (remoteTitle !== void 0 && path !== void 0) head.push((0, react.createElement)("span", {
				key: "path",
				className: "dsm-acp-tool__path",
				title: path
			}, path));
			head.push((0, react.createElement)("span", {
				key: "chevron",
				className: "dsm-acp-tool__chevron"
			}, expanded ? "−" : "+"));
			const body = [];
			if (args.rawInput !== void 0 && args.rawInput !== null) body.push((0, react.createElement)("div", {
				key: "in",
				className: "dsm-acp-tool__field"
			}, (0, react.createElement)("span", { className: "dsm-acp-tool__fieldLabel" }, "输入"), (0, react.createElement)("pre", { className: "dsm-acp-tool__pre" }, JSON.stringify(args.rawInput, null, 2))));
			if (args.locations !== void 0 && args.locations.length > 0) body.push((0, react.createElement)("div", {
				key: "files",
				className: "dsm-acp-tool__field"
			}, (0, react.createElement)("span", { className: "dsm-acp-tool__fieldLabel" }, "文件"), (0, react.createElement)("div", { className: "dsm-acp-tool__files" }, args.locations.map((entry, index) => {
				const target = displayPath(entry.path, props.cwd);
				return (0, react.createElement)("button", {
					key: `${entry.path}#${String(index)}`,
					type: "button",
					className: "dsm-acp-tool__file",
					onClick: () => {
						props.openFile?.(entry.path, entry.line === void 0 ? void 0 : { line: entry.line });
					}
				}, entry.line === void 0 ? target : `${target}:${String(entry.line)}`);
			}))));
			body.push((0, react.createElement)("div", {
				key: "out",
				className: "dsm-acp-tool__field"
			}, (0, react.createElement)("span", { className: "dsm-acp-tool__fieldLabel" }, "输出"), (0, react.createElement)("pre", { className: "dsm-acp-tool__pre" }, output ?? (failed ? "远端调用失败。" : props.phase === "result" ? "（远端没有返回内容）" : "运行中…"))));
			return (0, react.createElement)("div", {
				className: "dsm-acp-tool",
				"data-state": state
			}, (0, react.createElement)("button", {
				type: "button",
				className: "dsm-acp-tool__head",
				"aria-expanded": expanded,
				onClick: toggle
			}, head), expanded ? (0, react.createElement)("div", { className: "dsm-acp-tool__body" }, body) : null);
		}
		//#endregion
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

/* The mirrored ACP tool row. It is claimed through the keyed tool.call.toolview
   slot, so it must carry its own layout; the tokens are the product's. */
.dsm-acp-tool {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.dsm-acp-tool__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.dsm-acp-tool__head:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsm-acp-tool__dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
}
.dsm-acp-tool__dot[data-state='running'] { background: var(--dsw-alias-state-warn-primary); }
.dsm-acp-tool__dot[data-state='ok'] { background: var(--dsw-alias-state-success-primary); }
.dsm-acp-tool__dot[data-state='error'] { background: var(--dsw-alias-state-error-primary); }
.dsm-acp-tool__kind {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-fill-tsp-secondary);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dsm-acp-tool__headline {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsm-acp-tool__path {
  flex: 0 1 auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dsm-acp-tool__chevron { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); }
.dsm-acp-tool__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsm-acp-tool__field { display: flex; flex-direction: column; gap: 4px; }
.dsm-acp-tool__fieldLabel { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsm-acp-tool__pre {
  margin: 0;
  padding: 6px 8px;
  max-height: 260px;
  overflow: auto;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
  word-break: break-word;
}
.dsm-acp-tool__files { display: flex; flex-wrap: wrap; gap: 6px; }
.dsm-acp-tool__file {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--dsw-alias-brand-primary);
  font: inherit;
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
}

/* The ACP settings page. It renders inside the settings panel's content column
   rather than inside this plugin's own tabs, so it follows the same material
   and type scale as the product's own settings pages: every color and radius
   resolves through a --dsw-alias-* / --dsw-radius-* token, because a literal
   would stay light under the dark theme. */
.dsm-acp-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
  padding-bottom: 24px;
  color: var(--dsw-alias-label-primary);
}
.dsm-acp-page__title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsm-acp-page__note {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-tertiary);
}
.dsm-acp-page__warn {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-warn-label);
}
.dsm-acp-page__link { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.dsm-acp-page__link:hover { text-decoration: underline; }
.dsm-acp-page__empty {
  margin: 0;
  padding: 12px 14px;
  border: 0.5px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xl);
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.dsm-acp-page__presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dsm-acp-page__presetLabel {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsm-acp-page__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

/* One agent: the settings-card material the product's own row cards use. */
.dsm-acp-page__agent {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}
.dsm-acp-page__agent--off { opacity: 0.72; }
.dsm-acp-page__agentHead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-bottom: 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsm-acp-page__name {
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
/* An annotation on the name, at caption size, so it never competes with it. */
.dsm-acp-page__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* The product's own status badge recipe: primary is the readable green in each
   theme, tertiary the tint it sits on (green-100 light, green-900 dark). */
.dsm-acp-page__chip--on {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 20%, transparent);
  background: var(--dsw-alias-state-success-tertiary);
  color: var(--dsw-alias-state-success-primary);
}
.dsm-acp-page__spacer { flex: 1; min-width: 0; }
.dsm-acp-page__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: 12px 16px;
}
.dsm-acp-page__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dsm-acp-page__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dsm-acp-page__wide { grid-column: 1 / -1; }
.dsm-acp-page__check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
}
.dsm-acp-page__check input[type='checkbox'] {
  width: 14px;
  height: 14px;
  accent-color: var(--dsw-alias-button-primary-fill);
}
.dsm-acp-page__input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
}
.dsm-acp-page__input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dsm-acp-page__input:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary);
}
.dsm-acp-page__input:disabled {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
}
select.dsm-acp-page__input { cursor: pointer; }
textarea.dsm-acp-page__input {
  height: auto;
  min-height: 66px;
  padding: 6px 10px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 18px;
}

/* The secondary half of an agent, on the inset editing surface. */
.dsm-acp-page__more {
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-module-platform);
  padding: 8px 10px;
}
.dsm-acp-page__more > summary {
  cursor: pointer;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dsm-acp-page__more[open] > summary { margin-bottom: 10px; }
.dsm-acp-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
}
.dsm-acp-page__button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dsm-acp-page__button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsm-acp-page__button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dsm-acp-page__button:disabled { opacity: 0.45; cursor: default; }
.dsm-acp-page__button--primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-weight: 500;
}
.dsm-acp-page__button--primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsm-acp-page__button--danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}
.dsm-acp-page__problems {
  margin: 0;
  padding: 0 0 0 16px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}
.dsm-acp-page__error {
  margin: 0;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}
.dsm-acp-page__dirty {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-warn-label);
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
		/** Scale one pixel of wheel delta multiplies the canvas by. */
		const WHEEL_ZOOM_BASE = 1.005;
		/** Largest scale change one wheel event may apply on its own. */
		const WHEEL_ZOOM_MAX_STEP = 1.25;
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
				const current = props.useSessions((state) => foregroundSessionId(state, props.sessionId));
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
				const graph = react.useMemo(() => {
					return buildGraph(ids, byId, workspaces, hideSubagents, {
						global: showPrompts,
						opened: openedLines,
						collapsed: collapsedLines
					}, expandedInherited);
				}, [
					ids,
					byId,
					workspaces,
					hideSubagents,
					showPrompts,
					openedLines,
					collapsedLines,
					expandedInherited
				]);
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
				react.useLayoutEffect(() => {
					setPlaced(false);
				}, [showPrompts, hideSubagents]);
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
							const follows = sidebarShowsMap(runtime);
							runtime.openSession(box.sessionId);
							if (follows) followMapIntoNextSession(runtime);
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
			ctx.effect(() => slots.inject("tool.call.toolview", () => {
				const disposers = ACP_TOOL_KEYS.map((key) => slots.register({
					name: "tool.call.toolview",
					key
				}, AcpToolRow));
				return () => {
					for (const dispose of disposers) dispose();
				};
			}), "session-map: acp tool rows");
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
				ctx.effect(claimType(MAP_TYPE_ID, MAP_KIND, () => "会话图谱", () => "会话图谱", () => "所有会话的 fork 树画布"), "session-map: rightbar tab type");
				ctx.effect(() => scopedSlots.inject("sidebar.right.pane.tab", () => scopedSlots.register({
					name: "sidebar.right.pane.tab",
					key: MAP_TYPE_ID
				}, SidebarMapBody)), "session-map: rightbar tab body");
			});
			ctx.inject(["slots", "configForms"], (scope) => {
				const scopedSlots = lookup(scope, "slots");
				const configForms = lookup(scope, "configForms");
				if (scopedSlots === void 0 || configForms === void 0) return;
				const AcpCard = createAcpCard(configForms);
				ctx.effect(() => scopedSlots.inject("settings.section", () => scopedSlots.register({
					name: "settings.section",
					id: "acp",
					order: 25,
					label: "ACP"
				}, AcpCard)), "session-map: acp vendors settings section");
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