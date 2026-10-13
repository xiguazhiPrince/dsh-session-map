//#region src/client/model-scope.ts
/**
* Model scope: which providers one Session's model card may offer.
*
* An ACP Session belongs to an agent, but the product's model card offers every
* registered provider to every Session — the catalog it reads is global by
* construction, and there is no per-Session filter in the product (the measured
* evidence is in `docs/p10-acp-model-scope.md`). This module closes that gap
* **without touching the card**: it wraps the one per-Session data entry both
* model pickers share, `modelDirectories.directoryFor(sessionId)`, and scopes the
* list that comes back.
*
* It also settles the disagreement that gap exposes. A preset card cannot write
* the Session's model selection (`PresetDefinition` has no model, and the
* selection is installed before the preset mounts), so a card Session routes to
* its agent while the composer still shows the profile default. The same wrapper
* therefore keeps the stored selection in step with the preset — onto the agent
* when the Session is composed with one, and back off it when the Session leaves,
* which is the direction a half-measure would miss.
*
* Three properties are what make wrapping someone else's method acceptable here:
*
* - **Fail-open.** Any shape this module does not recognize — no service, no
*   `directoryFor`, a directory whose store is unreadable — returns the original
*   value untouched. The worst outcome of a product change is that the scope
*   stops applying, never that the composer breaks.
* - **Reversible.** The patch is a single property assignment, undone by the
*   disposer the plugin fiber owns.
* - **uSES-safe.** The card reads through `useSyncExternalStore`, which requires
*   an unchanged snapshot to be the *same object* or React re-renders forever.
*   The scope therefore memoizes on (underlying snapshot, mode, agent) and hands
*   back the previous object whenever the scoped list did not change.
*
* The filter is pure and the installer takes its collaborators as arguments, both
* so the Node suite can drive the whole thing without a DOM or a Host.
*
* @module dsh-session-map/client/model-scope
*/
/** The provider route this package's agents are models of. */
const ACP_PROVIDER = "acp";
/** The preset-id prefix this package's cards use: `acp-<agent>`. */
const ACP_PRESET_PREFIX = "acp-";
/**
* Separates an agent from one of the models it advertised.
*
* Spelled here rather than imported: the browser half must not pull the Host
* half's graph into its bundle, and the canonical definition is
* `src/acp-agent/model-id.ts` — the two must agree on this one string.
*/
const MODEL_ID_SEPARATOR = "::";
/** The browser-local preference holding the mode. */
const MODEL_SCOPE_KEY = "dsh.session-map.acpModelScope";
/** The shipped mode. */
const DEFAULT_MODEL_SCOPE = "scoped";
/**
* A value no projection can equal, so a Session's first read always settles as a
* fresh preset value rather than as a repeat of an absent one.
*/
const UNSETTLED = Symbol("unsettled");
/**
* @param preset - a Session's projected preset id.
* @returns true when it names one of this package's agent cards.
*/
function isAcpPreset(preset) {
	return typeof preset === "string" && preset.startsWith("acp-");
}
/**
* The agent one of this package's preset ids names.
*
* A preset card does not — and cannot — write a model selection: `PresetDefinition`
* carries no model, and the Session's own selection is installed before the preset
* is mounted (P0). So a Session started from a card routes to its agent while its
* *stored* selection is still whatever the profile default was, and the composer
* legitimately disagrees with the traffic. This is the value the reconciliation
* below needs to end that disagreement.
* @param preset - the Session's projected preset id.
* @returns the agent name, or `undefined` when the value is not one of our cards.
*/
function agentFromPresetId(preset) {
	if (!isAcpPreset(preset)) return void 0;
	const agent = preset.slice(4);
	return agent === "" ? void 0 : agent;
}
/**
* Whether a Session's stored selection has to be pulled onto its agent.
*
* Conservative in both directions: a selection that cannot be read yet (`null`,
* or a shape this module does not know) is *not* a reason to write, and a
* selection already naming this agent — `cursor` or `cursor::<one of its models>`
* — is left exactly as the user left it.
* @param selection - the projected model selection (`{provider, model}`).
* @param agent - the agent the Session's preset names, when it names one.
* @returns true only when the Session is ours and its selection points elsewhere.
*/
function needsAgentSelection(selection, agent) {
	if (agent === void 0) return false;
	if (selection === null || typeof selection !== "object") return false;
	const record = selection;
	if (record.provider !== "acp") return true;
	if (typeof record.model !== "string") return true;
	return record.model !== agent && !record.model.startsWith(`${agent}::`);
}
/**
* A selection, when the value is one this module is willing to write back.
* @param value - the projected selection, or a remembered one.
* @returns `{provider, model}`, or `undefined` when it is not usable.
*/
function asSelection(value) {
	if (value === null || typeof value !== "object") return void 0;
	const record = value;
	if (typeof record.provider !== "string" || typeof record.model !== "string") return void 0;
	return {
		provider: record.provider,
		model: record.model
	};
}
/**
* The first model of the first provider that is not ours.
*
* The fallback when a Session has to leave an agent and there is no memory of
* what it used before — a profile whose *default* is an ACP model, for instance.
* @param groups - the catalog's provider groups.
* @returns the selection, or `undefined` when no other provider offers one yet.
*/
function firstForeignSelection(groups) {
	if (!Array.isArray(groups)) return void 0;
	for (const group of groups) {
		if (group === null || typeof group !== "object") continue;
		const record = group;
		if (record.id === "acp" || typeof record.id !== "string") continue;
		if (!Array.isArray(record.models)) continue;
		for (const model of record.models) {
			if (model === null || typeof model !== "object") continue;
			const id = model.id;
			if (typeof id === "string") return {
				provider: record.id,
				model: id
			};
		}
	}
}
/**
* Decide what a Session's selection should be, given the preset it is composed
* with.
*
* This is the symmetric half of the feature: an agent Session is moved onto its
* agent, and a Session that has *left* the agent is moved off it again — back to
* the selection it displaced when we know it, else to the first model of another
* provider. Without the second direction a Session would keep routing to an agent
* it is no longer composed with.
* @param presetValue - the Session's projected preset id (the face existed).
* @param selection - the Session's projected model selection.
* @param groups - the catalog's provider groups.
* @param stashed - the selection this module displaced for this Session, if any.
* @returns the plan.
*/
function planReconciliation(presetValue, selection, groups, stashed) {
	const current = asSelection(selection);
	if (current === void 0) return { kind: "idle" };
	const agent = agentFromPresetId(presetValue);
	if (agent !== void 0) {
		if (!needsAgentSelection(current, agent)) return { kind: "none" };
		return {
			kind: "move",
			provider: "acp",
			model: agent,
			...current.provider === "acp" ? {} : { remember: current }
		};
	}
	if (current.provider !== "acp") return { kind: "none" };
	const target = asSelection(stashed) ?? firstForeignSelection(groups);
	if (target === void 0) return { kind: "idle" };
	return {
		kind: "move",
		provider: target.provider,
		model: target.model
	};
}
/**
* Classify one Session from its preset projection.
*
* `unknown` is reserved for "there is no projection to read", which is what keeps
* a composition without the preset feature from having ACP hidden everywhere.
* @param face - the Session's preset projection, when one exists.
* @returns `acp`, `other`, or `unknown`.
*/
function sessionAgent(face) {
	if (face === void 0) return "unknown";
	try {
		return isAcpPreset(face.getSnapshot()) ? "acp" : "other";
	} catch {
		return "unknown";
	}
}
/**
* The provider groups one Session may be offered.
* @param groups - the catalog's provider groups.
* @param mode - the scope in force.
* @param agent - what the Session's preset projection says.
* @returns `groups` itself whenever nothing is removed, so an unchanged list keeps
*   the identity `useSyncExternalStore` needs.
*/
function scopeGroups(groups, mode, agent) {
	if (mode === "off" || agent === "unknown") return groups;
	const isAcp = (group) => group.id === "acp";
	if (agent === "acp") {
		const kept = groups.filter(isAcp);
		return kept.length === groups.length ? groups : kept;
	}
	if (mode === "pinned") return groups;
	const kept = groups.filter((group) => !isAcp(group));
	return kept.length === groups.length ? groups : kept;
}
/**
* One snapshot with its groups scoped.
* @param snapshot - a directory snapshot.
* @param mode - the scope in force.
* @param agent - what the Session's preset projection says.
* @returns the same object when nothing changes.
*/
function scopeSnapshot(snapshot, mode, agent) {
	const groups = snapshot?.groups;
	if (!Array.isArray(groups)) return snapshot;
	const scoped = scopeGroups(groups, mode, agent);
	return scoped === groups ? snapshot : {
		...snapshot,
		groups: scoped
	};
}
/**
* A snapshot reader that returns the same object while its inputs are unchanged.
*
* Without this, every `getSnapshot()` would allocate a new scoped snapshot and
* `useSyncExternalStore` would treat each read as a change.
* @returns the memoized reader.
*/
function createSnapshotScope() {
	let last;
	let lastMode;
	let lastAgent;
	let lastResult;
	return (snapshot, mode, agent) => {
		if (snapshot === last && mode === lastMode && agent === lastAgent && lastResult !== void 0) return lastResult;
		const result = scopeSnapshot(snapshot, mode, agent);
		last = snapshot;
		lastMode = mode;
		lastAgent = agent;
		lastResult = result;
		return result;
	};
}
/**
* Read the browser's scope preference.
* @param storage - the storage to read; defaults to `localStorage` when the
*   runtime has one.
* @returns the recorded mode, or the shipped default.
*/
function readModelScopeMode(storage) {
	let source = storage;
	if (source === void 0) try {
		source = globalThis.localStorage;
	} catch {
		return DEFAULT_MODEL_SCOPE;
	}
	if (source === void 0) return DEFAULT_MODEL_SCOPE;
	try {
		const stored = source.getItem(MODEL_SCOPE_KEY);
		if (stored === "off" || stored === "pinned" || stored === "scoped") return stored;
	} catch {}
	return DEFAULT_MODEL_SCOPE;
}
/**
* Wrap one directory so the store it exposes is scoped.
* @param directory - the object `directoryFor` returned.
* @param sessionId - the Session it belongs to.
* @param host - the client runtime the projection is read from.
* @param controls - the mode and the diagnostic sink.
* @returns the wrapper, or `undefined` when the shape is not one this module knows.
*/
function createScopedDirectory(directory, sessionId, host, controls) {
	const store = directory["store"];
	if (store === void 0 || typeof store.getSnapshot !== "function" || typeof store.subscribe !== "function") return;
	const readSnapshot = store.getSnapshot;
	const watchStore = store.subscribe;
	const read = createSnapshotScope();
	const listeners = /* @__PURE__ */ new Set();
	const notify = () => {
		for (const listener of [...listeners]) listener();
	};
	const disposers = [];
	let face = host.presetFaceOf?.(sessionId);
	let faceDisposer;
	/**
	* The preset projection, resolved lazily: a Session can be read before its
	* projection has landed, and the face is worth subscribing to the moment it
	* does — otherwise the first filtered list would be the last word.
	*/
	const currentFace = () => {
		if (face === void 0) face = host.presetFaceOf?.(sessionId);
		if (face !== void 0 && faceDisposer === void 0) try {
			faceDisposer = face.subscribe(notify);
		} catch (error) {
			controls.warn?.("dsh-session-map: could not watch a Session preset projection", error);
		}
		return face;
	};
	try {
		disposers.push(watchStore(notify));
	} catch (error) {
		controls.warn?.("dsh-session-map: could not watch the model directory store", error);
	}
	/** The preset value the current decision was made for, and whether it settled. */
	let settledFor = UNSETTLED;
	let settled = false;
	/** The selection this Session displaced when it was moved onto its agent. */
	let stashed;
	/**
	* Keep one Session's stored selection in agreement with its preset.
	*
	* A preset card cannot write the Session's model selection — `PresetDefinition`
	* carries no model, and the selection is installed before the preset mounts — so
	* a card Session routes to its agent while the composer still shows the profile
	* default. This is the write the card would have made: `provider: acp,
	* model: <agent>`, which the preset's own listener then passes through.
	*
	* Symmetric, because one direction is not enough: a Session that has left its
	* agent must be moved off it again, or it would keep a route its preset no
	* longer asks for. The selection the move displaced is remembered, so leaving
	* the agent restores what the Session actually had; with nothing remembered the
	* first model of another provider stands in.
	*
	* Settled per preset *value* rather than once per Session: changing the preset
	* is precisely the event this exists for. Nothing to compare yet (`null` before
	* the catalog loads, or no foreign provider to fall back to) leaves the decision
	* open, and a refusal is reported and abandoned rather than retried per render.
	* @param snapshot - the current scoped snapshot.
	* @param projection - the Session's preset projection, when one exists.
	*/
	const reconcile = (snapshot, projection) => {
		if (projection === void 0) return;
		const value = projection.getSnapshot();
		if (value !== settledFor) {
			settledFor = value;
			settled = false;
		}
		if (settled) return;
		const plan = planReconciliation(value, snapshot.current, snapshot.groups, stashed);
		if (plan.kind === "idle") return;
		const write = host.selectModel;
		if (write === void 0) return;
		settled = true;
		if (plan.kind === "none") return;
		if (plan.remember !== void 0) stashed = plan.remember;
		try {
			Promise.resolve(write({
				sessionId,
				provider: plan.provider,
				model: plan.model
			})).catch((error) => {
				controls.warn?.("dsh-session-map: could not move a Session onto the model its preset implies", error);
			});
		} catch (error) {
			controls.warn?.("dsh-session-map: could not move a Session onto the model its preset implies", error);
		}
	};
	const scopedStore = {
		getSnapshot: () => {
			const projection = currentFace();
			const snapshot = read(readSnapshot(), controls.mode(), sessionAgent(projection));
			reconcile(snapshot, projection);
			return snapshot;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
	return {
		facade: new Proxy(directory, { get: (target, property) => {
			if (property === "store") return scopedStore;
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		} }),
		dispose: () => {
			for (const dispose of disposers.reverse()) try {
				dispose();
			} catch {}
			try {
				faceDisposer?.();
			} catch {}
			faceDisposer = void 0;
			listeners.clear();
		}
	};
}
/**
* Install the scope by wrapping `modelDirectories.directoryFor`.
*
* The wrap is memoized per directory object, so the per-Session subscriptions are
* created once no matter how often the composer re-renders.
* @param host - the client runtime.
* @param controls - the mode and the diagnostic sink.
* @returns the disposer that restores the original method.
*/
function installModelScope(host, controls) {
	const target = host.models;
	const original = target?.directoryFor;
	if (target === void 0 || typeof original !== "function") {
		controls.warn?.("dsh-session-map: modelDirectories.directoryFor is unavailable; the ACP model scope is not installed", target);
		return () => {};
	}
	const scoped = /* @__PURE__ */ new WeakMap();
	const live = /* @__PURE__ */ new Set();
	let disposed = false;
	const wrapper = function scopedDirectoryFor(sessionId) {
		const directory = original.call(this, sessionId);
		if (directory === null || typeof directory !== "object") return directory;
		const existing = scoped.get(directory);
		if (existing !== void 0) return existing.facade;
		const entry = createScopedDirectory(directory, sessionId, host, controls);
		if (entry === void 0) return directory;
		scoped.set(directory, entry);
		live.add(entry);
		return entry.facade;
	};
	let restore;
	try {
		target.directoryFor = wrapper;
		if (target.directoryFor === wrapper) restore = () => {
			target.directoryFor = original;
		};
	} catch {}
	if (restore === void 0) {
		const prototype = Object.getPrototypeOf(target);
		if (prototype !== null && typeof prototype.directoryFor === "function") try {
			prototype.directoryFor = wrapper;
			if (prototype.directoryFor === wrapper) restore = () => {
				prototype.directoryFor = original;
			};
		} catch {}
	}
	if (restore === void 0) {
		controls.warn?.("dsh-session-map: modelDirectories.directoryFor could not be wrapped; the ACP model scope is not installed", target);
		return () => {};
	}
	return () => {
		if (disposed) return;
		disposed = true;
		restore();
		for (const entry of live) entry.dispose();
		live.clear();
	};
}
//#endregion
export { ACP_PRESET_PREFIX, ACP_PROVIDER, DEFAULT_MODEL_SCOPE, MODEL_ID_SEPARATOR, MODEL_SCOPE_KEY, agentFromPresetId, createSnapshotScope, installModelScope, isAcpPreset, needsAgentSelection, planReconciliation, readModelScopeMode, scopeGroups, scopeSnapshot, sessionAgent };

//# sourceMappingURL=model-scope.js.map