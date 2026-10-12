//#region src/spike/index.ts
/**
* P0 spike: prove the seams a full ACP-backed session would rest on, before any
* of it is written for real.
*
* Three questions, one throwaway plugin:
*
* 1. Can a plugin register an `llm` adapter that the running Agent loop
*    actually picks up, and does that route appear in the Host model catalog?
* 2. Do the raw `StreamChunk`s such an adapter emits land as ordinary Session
*    events, so the shipped Chat UI renders them with no product changes?
* 3. Which mechanism can pin one Session's route to a chosen provider?
*
* Nothing here talks to ACP. The adapter is scripted so a failure is
* unambiguously a seam failure, not a protocol failure. It is inert unless the
* Loader mounts it, and the route pin is opt-in through `DSH_SPIKE_PIN` so the
* probe never writes a model default on its own.
*
* The adapter is duck-typed on purpose: this package's profile never carries
* `@deepseek-ai/*`, so a value import would fail at load (see `../acp/contract.ts`).
* The shapes below mirror `@deepseek-ai/dsh-llm` `src/index.ts` (`LlmAdapter`,
* `LlmRuntime.registerAdapter`) and `src/assembler.ts` (the chunk protocol is
* delta-tolerant: no `block-start`/`block-end` is required).
*
* @module dsh-session-map/spike
*/
/** Plugin name the Loader reports. */
const name = "spike";
/** Hard dependencies: the adapter registry and the tool registry. */
const inject = ["llm", "tools"];
/** The single provider route this spike owns. */
const PROVIDER = "spike";
/** Tool the scheduled tool-call probe calls; also the UI's generic-card fallback key. */
const TOOL_NAME = "spike_mirror";
/** Every model this provider advertises, in catalog order. */
const MODELS = [{
	id: "probe-text",
	name: "Spike · text + reasoning"
}, {
	id: "probe-tools",
	name: "Spike · text + reasoning + one tool call"
}];
/**
* Scripted `LlmAdapter`. Emits a fixed block sequence per model so the Session
* log can be read back as evidence: `probe-text` never calls a tool,
* `probe-tools` calls {@link TOOL_NAME} once and then wraps up.
*/
var SpikeAdapter = class {
	log;
	/** @param log - Host-visible sink for the probe's own observations. */
	constructor(log) {
		this.log = log;
	}
	/**
	* Advertise the route. `registerAdapter` rejects a registration whose
	* `providerInfo().id` does not equal the requested provider.
	* @param provider - the route being described.
	* @returns the metadata the registry stores.
	*/
	providerInfo(provider) {
		return {
			id: provider,
			name: "Spike (P0 probe)"
		};
	}
	/** No provider-specific retry policy: the registry's default applies. */
	providerRetryPolicy() {}
	/** No image pricing: this route accepts no images. */
	imageRequestPricing() {}
	/**
	* @param provider - the route being listed.
	* @returns every model the catalog should offer for it.
	*/
	async listModels(provider) {
		return MODELS.map((model) => ({
			provider,
			id: model.id,
			name: model.name
		}));
	}
	/**
	* @param provider - the route being resolved.
	* @param model - the requested model id.
	* @returns resolved metadata for one exact route.
	*/
	async resolveModel(provider, model) {
		if (!MODELS.some((candidate) => candidate.id === model)) throw new Error(`spike: unknown model "${model}" on provider "${provider}"`);
		return {
			provider,
			id: model,
			name: model,
			context: { contextWindow: 128e3 }
		};
	}
	/**
	* Bind one call to this registration, mirroring `PreparedAdapterCall`.
	* @param provider - the route being prepared.
	* @param model - the requested model id.
	* @returns the resolved model plus the stream entry point.
	*/
	async prepareCall(provider, model) {
		return {
			model: await this.resolveModel(provider, model),
			stream: (options) => this.stream(options)
		};
	}
	/**
	* The raw chunk stream for one call.
	*
	* Written statelessly: the wrap-up step is recognised by the presence of a
	* `tool` role message in the request, not by a per-session counter, so a
	* resumed or replayed session behaves the same way.
	* @param options - the assembled request.
	* @returns the chunks in stream order.
	*/
	async *stream(options) {
		const { model, purpose } = options;
		const continuing = (options.messages ?? []).at(-1)?.role === "tool";
		this.log(`stream(provider=${options.provider} model=${model} purpose=${purpose ?? "-"} continuing=${String(continuing)})`);
		if (purpose !== void 0) {
			yield {
				type: "text-delta",
				index: 0,
				text: `spike:${purpose}`
			};
			yield {
				type: "finish",
				reason: { kind: "stop" }
			};
			return;
		}
		if (model === "probe-tools" && !continuing) {
			yield {
				type: "reasoning-delta",
				index: 0,
				text: "Spike reasoning block: one tool call follows."
			};
			yield {
				type: "text-delta",
				index: 1,
				text: "Spike text block: calling the mirror tool now."
			};
			yield {
				type: "tool-call-delta",
				index: 2,
				id: "spike-call-1",
				name: TOOL_NAME,
				argumentsDelta: JSON.stringify({ note: "P0 probe payload" })
			};
			yield {
				type: "usage",
				usage: {
					inputTokens: 13,
					outputTokens: 9
				}
			};
			yield {
				type: "finish",
				reason: { kind: "tool-calls" }
			};
			return;
		}
		yield {
			type: "reasoning-delta",
			index: 0,
			text: "Spike reasoning block: nothing further to call."
		};
		yield {
			type: "text-delta",
			index: 1,
			text: continuing ? "Spike text block: tool result observed, turn complete." : "Spike text block: hello from a plugin-registered adapter."
		};
		yield {
			type: "usage",
			usage: {
				inputTokens: 11,
				outputTokens: 7
			}
		};
		yield {
			type: "finish",
			reason: { kind: "stop" }
		};
	}
};
/**
* The mirror tool. In the real backend this is where a remote ACP agent's
* already-executed tool call is replayed into the Session log as a first-class
* `tool/call` + `tool/result` pair, which is what makes the shipped tool card
* render with a real status and result instead of a dangling call.
*/
const mirrorTool = {
	name: TOOL_NAME,
	description: "P0 probe: mirrors a tool call a remote agent already executed.",
	parameters: {
		type: "object",
		properties: { note: {
			type: "string",
			description: "Payload the probe echoes back."
		} },
		required: [],
		additionalProperties: false
	},
	output: {
		schema: {
			type: "object",
			properties: { echoed: { type: "string" } },
			required: ["echoed"],
			additionalProperties: false
		},
		/** @param _args - validated arguments, unused by this probe. @param value - the canonical value. */
		render(_args, value) {
			return [{
				type: "text",
				text: `spike_mirror returned ${JSON.stringify(value)}`
			}];
		}
	},
	/**
	* @param args - validated model arguments.
	* @returns the canonical value declared by `output.schema`.
	*/
	async execute(args) {
		const note = args?.note;
		return { echoed: typeof note === "string" ? note : "" };
	}
};
/**
* Mount the probe: register the adapter and the mirror tool, report what the
* registry now holds, and optionally pin the deployment default model.
* @param ctx - Host context carrying `llm` and `tools`.
*/
function apply(ctx) {
	const log = (message) => {
		ctx.logger.warn(`[spike] ${message}`);
	};
	const adapter = new SpikeAdapter(log);
	ctx.llm.registerAdapter([PROVIDER], adapter);
	ctx.tools.register(mirrorTool);
	const registered = ctx.llm.listProviders().map((provider) => provider.id);
	log(`adapter registered for "${PROVIDER}"; llm.listProviders() = ${JSON.stringify(registered)}`);
	const pin = process.env.DSH_SPIKE_PIN;
	if (pin === void 0 || pin === "") {
		log("DSH_SPIKE_PIN unset: no model default was written");
		return;
	}
	const slash = pin.indexOf("/");
	const target = slash === -1 ? {
		provider: PROVIDER,
		model: pin
	} : {
		provider: pin.slice(0, slash),
		model: pin.slice(slash + 1)
	};
	ctx.inject(["agentDefaultModel"], (scoped) => {
		scoped.agentDefaultModel.saveSelection(target).then(() => {
			log(`pinned the deployment default model to ${target.provider}/${target.model}`);
		}).catch((error) => {
			log(`pin failed: ${String(error)}`);
		});
	});
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=spike.js.map