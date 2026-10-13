# P9 record — the agent's own model list

**Date:** 2026-10-13 · **Status:** host half complete and measured against a real
agent; the browser check is written down, not run
**Builds on:** [P0](p0-spike.md) · [P1](p1-acp-route.md) · [P2](p2-preset-cards.md) · [P3](p3-lifecycle.md) · [P4](p4-approval-bridge.md) · [P5](p5-client-tool-views.md) · [P6](p6-fs-bridge.md) · [P7](p7-remove-delegation.md) · [P8](p8-acp-settings-page.md)

## What P9 delivers

An ACP agent advertises a *model selector* of its own, and until now the route
hid it: one agent was one model id, and the only way to change which inner model
Cursor used was the free-form `configOptions` box on the settings page — write a
value blind, at session start, and hope.

P9 publishes what the agent says. Each configured agent now contributes
`<agent>` (unchanged, the agent's own default) plus one entry per value its
selector advertises — `<agent>::<value>` — so the inner models are selectable in
the Host's **own** model picker, and a selection made there is put in force before
the prompt that depends on it. Nothing about the Session, the picker or the
conversation surface changed; the route simply answers `listModels` with more
truth.

| File | Role |
|---|---|
| [`src/acp-agent/model-id.ts`](../src/acp-agent/model-id.ts) | The id codec: `<agent>`, `<agent>::<value>`, split on the last separator, and the name check that keeps it unambiguous |
| [`src/acp-agent/channel.ts`](../src/acp-agent/channel.ts) | Reads the option set an agent publishes, keeps it fresh from responses and `config_option_update`, and writes one option back (`setConfigOption`, `applyModel`) |
| [`src/acp-agent/adapter.ts`](../src/acp-agent/adapter.ts) | Discovery (cached, single-flight, bounded), the enriched `listModels`, and per-turn reconciliation |
| [`src/acp-agent/config.ts`](../src/acp-agent/config.ts) | `modelDiscovery` (`off`/`lazy`/`eager`), `discoveryTimeoutMs`, `discoveryTtlMs`, and the agent-name check |
| [`src/acp-preset/index.ts`](../src/acp-preset/index.ts) | The preset still decides which *agent*; it no longer decides which of that agent's models |
| [`test/mock-acp-agent.mjs`](../test/mock-acp-agent.mjs) | Scenarios: `model-list` (flat + grouped + boolean), `config-update`, `no-model-option`; `set_config_option` now echo-publishes the full set as a real agent does |
| [`test/model-options.test.mjs`](../test/model-options.test.mjs) | The wire behaviour, driven through the real adapter over a real child process |
| [`.dsh-dev/config-options-probe.mjs`](../.dsh-dev/config-options-probe.mjs) | Speaks ACP directly to a real agent and records what it publishes |
| [`.dsh-dev/model-list-probe.mjs`](../.dsh-dev/model-list-probe.mjs) | The route's own `listModels` against a real agent |

## Findings, each one measured

1. **The list is `configOptions`, and ACP has no "list models" call.** Cursor
   publishes two options: `mode` (category `mode`, 3 values) and `model`
   (category `model`, **44 values**, flat, `currentValue` `default[]` — and `Auto`
   is itself a selectable value, `{value: "default[]", name: "Auto"}`). The model
   selector is therefore a *session* fact: it arrives with `session/new`, never
   before one exists.
2. **The capability is not what makes the list appear.** The probe runs the
   handshake twice; the option set is identical either way. The first run
   advertised it at `clientCapabilities.configOptions` — which is **not in the
   schema** (it lives at `clientCapabilities.session.configOptions`), so that
   reading proved nothing and was re-measured with the correct path. The route
   advertises it properly anyway, because it is true of this client, not because
   anything depends on it.
3. **`session/set_config_option` is accepted mid-session and answers with the
   full option set.** That response is the only way a client learns what its
   selection resolved to (the request names a value; the reply names the value in
   force), so it is adopted as state. An **empty** `configOptions` array is
   treated as no news rather than as "this agent has none": erasing state on a
   bare `[]` would discard the selection the reply had just accepted.
4. **Discovery is slow and occasionally fails, which is the whole reason for the
   design.** Five handshakes measured 7.2, 7.4, 8.4, 13.3, 14.2 and 37.6 seconds,
   and one `session/new` came back `Internal error: Failed to initialize session
   services` while the very next spawn succeeded. A probe is therefore never on a
   path that can fail a turn, a failure is remembered for 60 s so a catalog read
   loop cannot become a spawn loop, and the bound depends on who is waiting:
   `eager` gets `discoveryTimeoutMs` (15 s default), a background `lazy` probe gets
   60 s because nothing is waiting on it.
5. **A selection persists on the agent's side.** After one probe selected
   `grok-4.6[effort=high,fast=true]`, the next fresh session already reported it as
   `currentValue`. ACP has no "unset", so `<agent>` means "re-assert the row's own
   configured options" — and an agent configured with no static model option keeps
   whatever was last selected until a new channel is built. Documented rather than
   papered over.
6. **A group has no `value`.** ACP's two shapes are `{value, name}` and
   `{group, name, options}`; the parser recognizes a group by its nested
   `options`, not by the key name, so a group without a `group` label still
   flattens. The first cut checked `value` first and silently read a group as a
   value — caught by the test that asserts the flattened labels.
7. **The advertised list is not a promise.** Cursor publishes
   `composer-2.5[fast=true]` and then *refuses* it (`Invalid model value`): the
   catalog is what the client may offer, not what the account can use. The route
   turns that refusal into a failed turn with the fixed
   `ACP failure (stage: prompt; category: configuration)` line and **does not send
   the prompt at all** — a refused selection must never become a silent answer
   from a different model. Measured end to end, through the route, against the real
   agent:

   ```
   model=real::gpt-5.4-mini[reasoning=medium]
   route:  session/new -> session/set_config_option -> session/prompt
   writes: [["model","gpt-5.4-mini[reasoning=medium]"]]
   text:   "model-switch-ok"
   finish: {"kind":"stop"}
   agent-reported model in force afterwards: "gpt-5.4-mini[reasoning=medium]"
   ```

   The same shape was reproduced for `gemini-2.5-flash[]` and
   `kimi-k2.7-code[]`, and the refusal for `composer-2.5[fast=true]`. The last
   line is the one that matters: it is the **agent's own** report of what is in
   force, not the client restating its request.

## Verified evidence

`pnpm typecheck` clean; `pnpm build` clean; `pnpm test` **38 passing / 1 skipped**
(the skip is the pre-existing POSIX resolution case). The eight new tests drive
the real `AcpAgentAdapter` and `AcpChannel` from `lib/acp-agent.js` against
`test/mock-acp-agent.mjs` over a real child process:

```
✔ modelDiscovery off lists one entry per agent and never spawns
✔ eager discovery publishes every advertised model, the legacy entry first
✔ an agent with no model selector contributes only its own entry
✔ a refused session is a fact about the agent, not a failure of the catalog
✔ a selected model is written before the prompt, and not written twice
✔ the legacy id restores the row configuration after an inner model was used
✔ the client advertises the config-option capability under session
✔ a mid-turn option update changes state and is never mistaken for content
```

The preset probe covers both halves of the split (`.dsh-dev/preset-order-probe.mjs`):

```
PASS a foreign selection is pinned to the agent:        {"provider":"acp","model":"cursor"}
PASS an inner model of this agent survives:             {"provider":"acp","model":"cursor::grok-4.6[effort=high]"}
PASS this agent without an inner model stays this agent:{"provider":"acp","model":"cursor"}
PASS another agent is still overridden:                 {"provider":"acp","model":"cursor"}
PASS an inner model of another agent is overridden too: {"provider":"acp","model":"cursor"}
```

The route against the real agent (`.dsh-dev/model-list-probe.mjs --mode eager`):

```
mode=eager agents=1 models=45 in 14234ms
  real  |  ACP · real
  real::default[]  |  ACP · real · Auto
  real::grok-4.7[context=256k,reasoning_effort=high,fast=true]  |  ACP · real · grok-4.7
legacy entries (one per agent): 1
```

and the regression line, `--mode off`, is one entry and **1 ms**: a catalog read
that may not spawn never does.

## Deliberate scope

- **Only `category: "model"` select options.** ACP says a category is a UX hint a
  client must tolerate the absence of, so an agent that names its selector
  something else, or omits the category, simply contributes no inner models —
  guessing by option name is the inference the spec warns against. Boolean
  options and the `model_config` / `thought_level` categories are read into state
  (so a future phase has them) but not offered as models.
- **`<agent>` keeps its meaning.** Every existing profile patch, preset pin and
  `agent-default-model` row still resolves; nothing has to be migrated.
- **No new UI and no client change.** The shipped model picker is the surface;
  `settings.models.provider-card` / `registerConfigurableProviders` were left
  alone — the directory registration is all-or-nothing on a duplicate provider
  and would need its own probe against, not alongside, the `acp` route.
- **`session/set_model` is not used.** It exists as a method name in this SDK's
  session table but has no typed request in the schema; `set_config_option` is the
  supported route.

## Not verified in this pass

- **Whether the picker re-reads the catalog while the page is open.** This is the
  one thing `lazy` depends on: a cold read answers with the legacy entry and warms
  the cache, so the models appear on the *next* read. If the picker caches for the
  page's lifetime, the default should become `eager` (or the settings page needs a
  refresh control) — a product-side fact, not a route-side one.
- **The browser path.** The route, the discovery and the write are proven against
  a real agent; that the picker renders 45 entries and that selecting one changes
  what Cursor actually uses was not driven in a browser here. Steps below.

## Reproduce

```powershell
node .dsh-dev/config-options-probe.mjs                     # what a real agent publishes
node .dsh-dev/model-list-probe.mjs --mode off              # 1 entry, no spawn
node .dsh-dev/model-list-probe.mjs --mode eager            # 45 entries, ~14 s
# One turn through the route with a selected model, tapped on the wire:
node .dsh-dev/model-list-probe.mjs --mode off --model "real::gpt-5.4-mini[reasoning=medium]" --prompt "Reply with exactly: ok"
node .dsh-dev/preset-order-probe.mjs                       # the preset keeps the agent, not the model
pnpm typecheck; pnpm build; pnpm test

dsh --profile webdev
# 1. New Session → the model picker → provider "ACP agents (Cursor, opencode, …)".
# 2. First open: `ACP · cursor` only (the probe is warming). Reopen: one entry per
#    model cursor-agent advertises.
# 3. Select `ACP · cursor · grok-4.7` and ask anything; the reply is Cursor's, and
#    `session/set_config_option {configId:"model", value:"grok-4.7[…]"}` precedes
#    the prompt in the agent's own session.
# 4. With `modelDiscovery: off`, step 2 shows the single legacy entry again.
```
