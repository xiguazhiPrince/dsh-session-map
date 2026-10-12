# P2 record — the preset cards

**Date:** 2026-10-12 · **Status:** mechanism proven in isolation; card rendering
awaits the browser check · **Builds on:** [P0](p0-spike.md) · [P1](p1-acp-route.md)

## What P2 delivers

Every configured ACP agent now contributes a **preset card** to the new-task
picker (`ACP · cursor`, id `acp-cursor`), derived from the same `agents` list
that produces the model routes. Selecting the card starts a Session whose
requests are routed to that agent **without anyone touching the model selector**.

| File | Role |
|---|---|
| [`src/acp-preset/index.ts`](../src/acp-preset/index.ts) | The preset's child plugin: pins the Session's route |
| [`src/acp-agent/presets.ts`](../src/acp-agent/presets.ts) | Builds the declarations; one per agent |
| [`src/acp-agent/index.ts`](../src/acp-agent/index.ts) | Registers them against `ctx.agentPresets` when that service exists |

Cards are registered **at runtime** rather than declared as
`@deepseek-ai/dsh-agent-preset` rows. A base-only composition has neither the
registry service nor the declaration package, so a declared row would fail to
import; and a declared row would be a second place the agent list has to be kept
in sync.

## The mechanism, and the number that settles it

P0 established that a preset does **not** carry a model route: `PresetDefinition`
is `{id, name, description, order, plugins}`, and `api-session` installs its own
selection *before* `presets.mount` runs. So the preset contributes its own
`agent/request` listener with `{ prepend: true }`, and the answer to "does that
win?" is a property of Cordis's waterfall:

```
order: C(prepended) -> A(first-registered) -> B(second-registered)
```

A prepended listener runs **first / outermost**, so its returned object is merged
last and therefore wins. Reproduced against the **real build artifact**
(`.dsh-dev/preset-order-probe.mjs`), with the product's own three layers —
loop seed, `installModelSelection`, preset child plugin:

```
plugin fiber state: 2                              (ACTIVE)
resolved request config: {"provider":"acp","model":"cursor"}
provider/model pinned by the preset: YES
inherited reasoning effort dropped:  YES
```

Dropping the inherited effort is load-bearing, not tidiness: the ACP route
advertises no reasoning efforts, and the runtime rejects an explicit effort for a
model that declares none.

## Two findings worth more than the feature

1. **The headless app cannot exercise presets at all.** `@deepseek-ai/dsh-headless`
   composes no preset roster — its own source says so, and its runner's `setup`
   installs a model selection and never calls `presets.mount`. Selecting a preset
   is a **Host-layer** path (`sessionController.create({agentPreset})`). Consequence
   for the product of this work: on a headless/sdk composition the ACP **model
   route** exists but the **cards do not**, and no amount of profile ordering
   changes that. P2 is therefore verified through the browser, not headless.
2. **A waterfall probe must pass the base function.**
   `waterfall(name, payload, base)` — the last argument is the innermost `next`
   (`agent.ts` calls it exactly that way). My first probe omitted it and produced
   a false "the preset loses" reading. Any future probe of a product waterfall
   should copy the call shape from the emit site, not infer it.

## Reproduce

```powershell
node .dsh-dev/preset-order-probe.mjs        # mechanism: preset wins, effort dropped
node .dsh-dev/cordis-waterfall-probe.mjs    # semantics: prepend = outermost
```

## Browser check (the P2 acceptance)

The probe instance runs from `.dsh-dev/scratch` with the **default model pointed
at the scripted P0 adapter on purpose**, so the test cannot pass by accident:

1. New Session → the preset picker shows **ACP · cursor**.
2. Select it, then ask anything (e.g. *create p2-web.txt with hello, then reply
   done*).
3. Pass = Cursor's own answer plus an `acp_edit` tool card. Fail = a *"Spike text
   block"* reply, which means the card did not pin the route.
4. If the picker is missing entirely, Settings → General → **Coding Tools** must
   be on; that switch decides whether modes can be chosen at all.

## Deliberate scope

- A preset pins the route for **every** request in its Session, so the composer's
  model selector cannot switch that Session away from its agent. That is the
  intent — the card *is* the choice — but it is a behaviour to keep in mind.
- Cards are registered once per activation and re-registered on a volatile
  `agents` edit; a composition without the preset registry simply gets none.
- Nothing about P1's limitations changes here: read-only mirror, auto-answered
  permissions, no compaction, no `session/load`.
