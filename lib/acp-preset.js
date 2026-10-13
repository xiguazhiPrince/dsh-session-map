import { a as Schema, r as decodeModelId } from "./model-id-GAxkeSXu.mjs";
//#region src/acp-preset/index.ts
/**
* Preset child plugin: pin one Session's model route to a remote ACP agent.
*
* This is the half of "select ACP when you start a new Session" that a preset
* can actually do. P0 established that a preset does **not** carry a model
* route: `PresetDefinition` has no such field, and `api-session` installs its
* own selection before `presets.mount` runs. So the preset contributes its own
* `agent/request` listener and the route is reconciled by waterfall order —
* which is why this listener registers with `prepend`.
*
* Two details are load-bearing:
*
* - **The inherited reasoning effort is dropped.** The ACP route advertises no
*   reasoning efforts, and the runtime rejects an explicit effort for a model
*   that declares none, so passing one through would fail every request.
* - **Nothing is registered on a root service.** The preset activation audit
*   rejects services that leak out of the preset scope, and P0 confirmed
*   `ctx.llm.registerAdapter` would do exactly that. The adapter therefore lives
*   in the root row; this plugin only listens inside the Agent's own context.
*
* @module dsh-session-map/acp-preset
*/
/** Plugin name the Loader reports. */
const name = "acp-preset";
/** The row's configuration: which agent, under which provider route. */
const Config = Schema.object({
	agent: Schema.string().required(),
	provider: Schema.string().default("acp")
});
/**
* Bind this Session's requests to the configured ACP agent.
* @param ctx - the Agent's own scoped context.
* @param config - resolved row configuration.
*/
function apply(ctx, config) {
	const provider = config.provider ?? "acp";
	const model = config.agent;
	ctx.effect(() => ctx.on("agent/request", async (_payload, next) => {
		const resolved = await next();
		const { reasoningEffort: _inheritedEffort, ...rest } = resolved;
		const current = resolved;
		if ((current.provider === provider && typeof current.model === "string" ? decodeModelId(current.model) : void 0)?.agent === model) return { ...rest };
		return {
			...rest,
			provider,
			model
		};
	}, { prepend: true }), `${name}: pinned route ${provider}/${model}`);
}
//#endregion
export { Config, apply, name };

//# sourceMappingURL=acp-preset.js.map