//#region src/client/acp-mode-model.ts
/** The state before any agent has advertised modes. */
const EMPTY_ACP_MODES = Object.freeze({
	available: [],
	current: null
});
/** The report line every `/acp-mode` read answers with. */
const MODE_REPORT_PREFIX = "ACP mode: ";
/**
* Read ACP's `SessionModeState` into this vocabulary.
*
* Tolerant by design: an agent that publishes nothing recognizable yields
* `undefined`, a name falls back to the id, and a `currentModeId` the agent did not
* also advertise is replaced by the first advertised id rather than offered as a
* value nothing can select. The current id is read from ACP's `currentModeId` first
* and from this vocabulary's own `current` second, so a state that round-trips keeps
* the mode it recorded.
* @param modes - the raw `modes` field of an ACP `session/new` result.
* @returns the state, or `undefined` when no usable mode was advertised.
*/
function readModeState(modes) {
	if (modes === null || typeof modes !== "object") return void 0;
	const record = modes;
	if (!Array.isArray(record.availableModes)) return void 0;
	const available = [];
	for (const entry of record.availableModes) {
		if (entry === null || typeof entry !== "object") continue;
		const option = entry;
		if (typeof option.id !== "string" || option.id === "" || option.id.includes(" ")) continue;
		const name = typeof option.name === "string" && option.name !== "" ? option.name : option.id;
		const description = typeof option.description === "string" && option.description !== "" ? option.description : void 0;
		available.push(description === void 0 ? {
			id: option.id,
			name
		} : {
			id: option.id,
			name,
			description
		});
	}
	if (available.length === 0) return void 0;
	const wanted = typeof record.currentModeId === "string" ? record.currentModeId : typeof record.current === "string" ? record.current : void 0;
	return {
		available,
		current: wanted !== void 0 && available.some((mode) => mode.id === wanted) ? wanted : available[0].id
	};
}
/**
* Narrow a state to the fields a control renders, dropping anything unrecognizable.
* @param value - a state, or a projection value of unknown provenance.
* @returns the view, or `undefined` when it carries no usable mode.
*/
function readModeView(value) {
	if (value === null || typeof value !== "object") return void 0;
	const record = value;
	if (!Array.isArray(record.available)) return void 0;
	const state = readModeState({
		availableModes: record.available,
		currentModeId: record.current
	});
	return state === void 0 ? void 0 : state;
}
/**
* Render one report line.
*
* `id=Name`, with the current mode marked and the parts separated by `, ` — short
* enough for the command row a person sees, and ordered (`current` is not
* positional) so the two readers agree without sharing a process. Names are
* sanitized: a separator inside a name would make the line ambiguous, and the id is
* always recoverable.
* @param state - the state to report.
* @returns the line.
*/
function formatModeReport(state) {
	const parts = state.available.map((mode) => {
		const name = mode.name.replace(/[,=]/g, " ").trim() || mode.id;
		return mode.id === state.current ? `${mode.id}=${name} (current)` : `${mode.id}=${name}`;
	});
	return `${MODE_REPORT_PREFIX}${parts.join(", ")}`;
}
/**
* Parse a report line back into a state.
*
* The inverse of {@link formatModeReport}, and deliberately forgiving: a name is
* optional (`plan`), whitespace around the parts is ignored, and an entry that does
* not parse is skipped rather than failing the whole read — the control then shows
* the ids it could recover.
* @param text - the settled command text.
* @returns the parsed state, or `undefined` when the line is not a report.
*/
function parseModeReport(text) {
	if (typeof text !== "string" || !text.startsWith("ACP mode: ")) return void 0;
	const available = [];
	let current = null;
	for (const raw of text.slice(10).split(",")) {
		const entry = raw.trim();
		if (entry === "") continue;
		const marked = entry.endsWith("(current)");
		const body = (marked ? entry.slice(0, -9) : entry).trim();
		const separator = body.indexOf("=");
		const id = (separator === -1 ? body : body.slice(0, separator)).trim();
		const name = (separator === -1 ? body : body.slice(separator + 1)).trim();
		if (id === "" || id.includes(" ")) continue;
		available.push({
			id,
			name: name === "" ? id : name
		});
		if (marked) current = id;
	}
	if (available.length === 0) return void 0;
	return {
		available,
		current: current !== null && available.some((mode) => mode.id === current) ? current : available[0].id
	};
}
/**
* Split a command line.
*
* `@` introduces the agent, because the Session's route is not always readable from
* the Host side: a Session that has not sent its first message has no request header
* to name its agent, and the composer control — which does know — passes it.
* @param rawInput - everything after the command name.
* @returns the named parts.
*/
function parseModeArgv(rawInput) {
	const tokens = rawInput.trim().split(/\s+/).filter((token) => token !== "");
	const out = {};
	for (const token of tokens) if (token.startsWith("@")) out.agent = token.slice(1);
	else if (out.modeId === void 0) out.modeId = token;
	return out;
}
//#endregion
export { EMPTY_ACP_MODES, MODE_REPORT_PREFIX, formatModeReport, parseModeArgv, parseModeReport, readModeState, readModeView };

//# sourceMappingURL=acp-mode-model.js.map