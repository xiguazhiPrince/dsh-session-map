# P0 spike record — can a plugin drive a Session through a non-LLM route?

**Date:** 2026-10-12 · **Status:** host half proven; browser rendering awaits human check
**Scope:** throwaway probe. `src/spike/` was deleted once every phase had shipped
(see [P7](p7-remove-delegation.md)); this record stays because the seam shapes it
established are what the shipped route is built on.

## The question

Before writing any ACP code: can this package make a **normal DSH Session**
run on a route a plugin owns, so the shipped Chat UI renders the traffic with
no product changes? If yes, "DSH is an ACP client" becomes a mapping problem
instead of a UI problem.

## What was built

`src/spike/index.ts`, exported as `dsh-session-map/spike`, mounted as one row in
two throwaway profiles under `.dsh-dev`:

| Profile | App | Purpose |
|---|---|---|
| `spikeh` | `@deepseek-ai/dsh-headless` | automated event-level proof |
| `spike` | `@deepseek-ai/dsh-web-app` | browser rendering check (port 19487) |

It registers a scripted `LlmAdapter` for the provider route `spike` with two
models (`probe-text`, `probe-tools`) plus one mirror tool (`spike_mirror`), and
optionally writes the deployment default model when `DSH_SPIKE_PIN` is set. No
protocol code at all: a failure is unambiguously a seam failure.

## Results

### ① A plugin-registered adapter reaches the Agent loop — CONFIRMED

```
request/header {"provider":"spike","model":"probe-tools","reason":"initial"}
```

The loop called our `stream()`. `registerAdapter` also validates hard:
`providerInfo(provider)` must return the same `id`, and `providerRetryPolicy`
must exist (it is called unconditionally), so a duck-typed adapter has to
implement both — a bare `{ stream() }` is rejected.

### ② Chunks land as ordinary Session events — CONFIRMED

```
16 assistant/message {"turn":1,"step":1,"blocks":[
     "reasoning(Spike reasoning block: one tool call follows.)",
     "text(Spike text block: calling the mirror tool now.)",
     "tool-call(spike_mirror args={\"note\":\"P0 probe payload\"})"]}
17 tool/call   {"turn":1,"name":"spike_mirror","arguments":"{\"note\":\"P0 probe payload\"}"}
18 tool/result {"turn":1,"isError":false,"content":"[{\"type\":\"text\",\"text\":\"spike_mirror returned ...\"}]"}
21 assistant/message {"turn":1,"step":2,"blocks":[... wrap-up ...]}
23 turn/end {"turn":1,"reason":"completed"}
```

Reasoning, text and tool-call blocks assemble **in stream order** into one
`assistant/message`; the tool call executes locally and returns through
`tool/result`, and the loop issues a second step. No `block-start`/`block-end`
is required — the chunk protocol is delta-tolerant, which keeps the mapper thin.

This is exactly the shape P1 needs: a remote ACP agent's `tool_call` becomes a
first-class DSH tool call with a real status, duration and result, so the
shipped tool card renders natively and an unregistered tool name still falls
back to the generic card (`ToolCallTree.tsx` passes `fallback: <GenericToolCard>`).

### ③ Route pinning — the product's global default is NOT the answer

`DSH_SPIKE_PIN` writes `agentDefaultModel.saveSelection(...)` from the plugin.
It works, and it is unusable for this feature:

- **It races the runner.** The first pinned run still requested `probe-text`
  (the previous value); only the second run observed the pin. The headless
  runner reads the default before an effect-scoped save settles.
- **It is deployment-global**, not per-session, so it cannot express "this
  Session is the ACP one".

Two mechanisms remain, both still unproven:

- **(a) Preset child plugin.** `composeAgent` mounts the preset into the
  **agent context** before the first turn, and `agentCtx.on('agent/request',
  ..., { prepend: true })` exists (the model-selection module itself uses
  `{ prepend: true }`). A prepended listener is outermost, so it would win over
  the selection `api-session` installs first. Needs a run with a real preset.
- **(b) Client half.** On a blank Session whose recorded preset is an ACP one,
  the browser plugin calls the same `session/selectModel` Remote that
  `ui-model-selection` already uses. Verifiable only in the browser.

## Findings that change P1

1. **Presets do not carry a model route.** `PresetDefinition` is
   `{id, name, description, order, plugins}`; the registry README says presets
   choose "tools, prompt sections and skills", and `installSelection` runs
   *before* `presets.mount`. So the preset card selects the ACP **mode**; the
   route needs (a) or (b) from ③ on top of it.
2. **A preset-scoped adapter registration would be rejected.** `registerAdapter`
   binds its `ctx.effect` to the **`llm` service's own context**, not the
   caller's, so an adapter registered from a preset scope outlives that scope —
   which is precisely the "service leaked globally" condition the preset
   activation audit rejects. **The adapter must be registered once at root
   scope; only tools and prompt sections belong in the preset.**
3. **Compaction and session-title route through the same provider.** Confirmed,
   not hypothetical:
   ```
   14 session/title-llm-request {"route":{"provider":"spike","model":"probe-text"}, ...}
   15 session/title {"title":"spike:session-title", "source":{"kind":"provider", ...}}
   ```
   The session was titled `spike:session-title`. P1 must handle
   `GenerateOptions.purpose` explicitly — delegate to a real model, or decline —
   or every ACP session gets a nonsense title and garbage compactions.
4. **Headless startup requires a credential for the *default* route** even when
   the task never uses it (`MISSING_CREDENTIAL: llm-deepseek`). Irrelevant to the
   web app, but it means the probe needs a dummy `DEEPSEEK_API_KEY`.
5. **The session log is a sequence of zstd frames**, one per append; Node's sync
   and streaming decoders both stop at the first frame. Any tooling that reads
   `.jsonl.zstd` has to split on the frame magic first (see
   `.dsh-dev/dump-events.mjs`).

## Reproduce

```powershell
$env:DSH_HOME = "$PWD\.dsh-dev"
$env:DSH_SPIKE_PIN = 'probe-tools'      # ③ writes probe-tools; the NEXT run observes it
$env:DEEPSEEK_API_KEY = 'spike-dummy-key'
dsh --profile spikeh "P0 probe"
node .dsh-dev/dump-events.mjs <newest session.v4.jsonl.zstd>
```
