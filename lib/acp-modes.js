import { EMPTY_ACP_MODES, MODE_REPORT_PREFIX, formatModeReport, parseModeArgv, parseModeReport, readModeState, readModeView } from "./acp-mode-model.js";
//#region src/acp-agent/modes.ts
/**
* The ACP collaboration-mode surface (P11).
*
* An ACP agent advertises its own collaboration modes in `session/new`
* (`SessionModeState`: `{ currentModeId, availableModes }`) and changes them through
* the core `session/set_mode` method. `cursor-agent` advertises `agent`, `plan` and
* `ask`; another agent may advertise none, or other ids entirely. Nothing about this
* is vendor-specific, and nothing about it exists in DSH: measured across the
* product source, a Session has no notion of "the agent's mode".
*
* DSH's own plan mode cannot stand in for it — that feature is a DSH prompt section
* plus a DSH tool, and a remote ACP agent receives neither.
*
* What this module deliberately does NOT do is publish the state through a Session
* projection, which was the first design and is not available to a plugin: a
* projection needs a Session event, and `dsh-session`'s read path refuses a type
* outside the build's catalogue unless the envelope carries `ignorable: true`, which
* `Session.append` cannot set for a non-surface event. Writing one anyway made the
* Session unreadable (measured; see `../../docs/p11-acp-mode-select.md`).
*
* The one supported channel is a **registered command**:
*
* - a live Session's mode is switched by `session/set_mode` on its channel;
* - a mode chosen before the agent connected is held in memory and adopted by the
*   first channel that opens for that Session;
* - the report a read answers with is the state channel the client reads, in the
*   shape `./../client/acp-mode-model.ts` defines and parses.
*
* @module dsh-session-map/acp-agent/modes
*/
/** The command the composer control (or a person) executes. */
const ACP_MODE_COMMAND = "acp-mode";
/**
* The `/acp-mode` grammar, as one pure decision: no mode reports, a mode the agent
* advertised switches, anything else is refused with the ids that would have worked.
* @param state - the Session's known mode state.
* @param modeId - the mode the line named, when it named one.
* @returns the decision.
*/
function planModeSwitch(state, modeId) {
	const ids = state.available.map((mode) => mode.id);
	if (ids.length === 0) return {
		kind: "error",
		text: "This Session has no connected ACP agent yet, or its agent advertises no modes."
	};
	if (modeId === void 0) return {
		kind: "report",
		text: formatModeReport(state)
	};
	if (state.available.some((mode) => mode.id === modeId)) return {
		kind: "set",
		modeId
	};
	return {
		kind: "error",
		text: `Unknown ACP mode "${modeId}". Available: ${ids.join(", ")}`
	};
}
/**
* Install the mode surface: the command, and the registry of live channels.
*
* Registered through optional injection, so a composition without a command registry
* keeps the route working and simply offers no way to switch modes.
* @param ctx - the row's Host context.
* @param options - the route hooks a report needs when no channel exists.
* @returns the surface the adapter publishes through.
*/
function installAcpModes(ctx, options = {}) {
	const controllers = /* @__PURE__ */ new WeakMap();
	/** Modes picked before the Session's agent connected, adopted by its first channel. */
	const wanted = /* @__PURE__ */ new WeakMap();
	ctx.inject(["commands"], (scoped) => {
		const commands = scoped.commands;
		if (commands === void 0) return;
		commands.register({
			name: ACP_MODE_COMMAND,
			description: "Read or switch the ACP agent's collaboration mode",
			input: { hint: "[@agent] [mode]" },
			handler: async ({ agent, rawInput }) => {
				const session = agent?.session;
				if (session === void 0) return {
					kind: "error",
					text: "This command needs a Session."
				};
				const argv = parseModeArgv(rawInput);
				const controller = controllers.get(session);
				const plan = planModeSwitch(controller?.modeState() ?? (argv.agent === void 0 ? EMPTY_ACP_MODES : await options.probe?.(argv.agent) ?? EMPTY_ACP_MODES), argv.modeId);
				if (plan.kind === "report") return {
					kind: "success",
					text: plan.text
				};
				if (plan.kind === "error") return {
					kind: "error",
					text: plan.text
				};
				if (controller === void 0) {
					wanted.set(session, plan.modeId);
					return {
						kind: "success",
						text: `ACP mode: ${plan.modeId} (applies when the agent connects)`
					};
				}
				try {
					await controller.setMode(plan.modeId);
				} catch (error) {
					ctx.logger.warn("dsh-session-map/acp-agent: switching ACP mode failed: %o", error);
					return {
						kind: "error",
						text: `The agent refused mode "${plan.modeId}".`
					};
				}
				return {
					kind: "success",
					text: `ACP mode: ${plan.modeId}`
				};
			}
		});
	});
	return {
		attach: (session, controller) => {
			if (session === void 0) return () => {};
			controllers.set(session, controller);
			return () => {
				controllers.delete(session);
			};
		},
		takeWanted: (session) => {
			if (session === void 0) return void 0;
			const value = wanted.get(session);
			wanted.delete(session);
			return value;
		}
	};
}
//#endregion
export { ACP_MODE_COMMAND, EMPTY_ACP_MODES, MODE_REPORT_PREFIX, formatModeReport, installAcpModes, parseModeArgv, parseModeReport, planModeSwitch, readModeState, readModeView };

//# sourceMappingURL=acp-modes.js.map