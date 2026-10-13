# P10 — scoping the model list to the Session's agent

**Date:** 2026-10-13 · **Status:** implemented; mechanics verified by the Node
suite, the visible per-Session difference **not yet** verified (see §9)
**Builds on:** [P1](p1-acp-route.md) · [P2](p2-preset-cards.md) · [P8](p8-acp-settings-page.md) · [P9](p9-agent-model-list.md)
**Decision of record:** the user chose **R2** — with an ACP preset the composer's
model card lists only ACP models; without one it lists no ACP models at all — and
asked that the product's model card not be rewritten or replaced.

## 1. What this implements

| Session | Model card shows |
|---|---|
| Started with an ACP preset card (`acp-<agent>`) | only the ACP provider's models |
| Any other session | no ACP entry at all, i.e. exactly what it showed before P9's inner models existed |

Two consequences are accepted here rather than worked around:

- **P9's "select ACP like any other model" is retired.** Under R2 the ACP route is
  reachable only through a preset card. P9's discovery, id codec, per-turn
  `applyModel` and preset pass-through all stay; only the *catalog entry* goes away.
- **The card itself is untouched.** No second model control, no rewritten picker,
  no DOM hiding, no CSS. The card keeps rendering exactly what it renders today —
  it is simply handed a different list.

## 2. What the shipped shell actually does (measured)

Everything below was read out of the client bundles the probe instance on port
3080 serves to the browser (10,491,749 bytes of concatenated shell; the picker is
`@deepseek-ai/dsh-client-ui-model-selection`). This is why the obvious ideas do
not work, so it is recorded before the design.

**① The catalog is global, not per-session.** The list the card renders comes from

```js
// ModelCatalogDirectory (@9573119) — doc comment, verbatim:
/** Loads at most one model catalog for the current Host generation. */
/** …catalog shared by every Session selector. */
this.ctx.remote.session.modelCatalog()          // ← no sessionId argument
```

**② The seat is a `single` slot owned by the product.** `conversation.input.model`,
`replaceRisk: shadows-shipped-ui`, occupied by `ModelSelect` — a **31,827-character**
component that the module does **not** export (`exports.ModelDirectory`,
`exports.ModelDirectoryResolver`, `exports.apply`, `exports.inject` only). Replacing
the seat therefore means owning the picker for *every* session, forever.

**③ The one per-session data entry is `modelDirectories.directoryFor(sessionId)`.**

```js
// the seat (@9626681)
inject: (sessionId) => {
  const directory = models.directoryFor(sessionId)
  return { available, directory: directory.store, load, select }
}
// the /model command (@9625534, @9625814)
optionsOf(await models.directoryFor(session.sessionId).load(), t)
```

`directoryFor` has **exactly these call sites** — both are user-facing model
pickers, which is what we want to scope. The settings pages and the subagent
allow-list call `remote.session.modelCatalog()` directly and are therefore
unaffected.

**④ The product already has the two RPCs a second control would need**
(`llm.discoverModels`, `session.selectModel`) — recorded because it makes the
*rejected* alternative C cheap, not because this plan uses them.

**⑤ A stable DOM anchor exists but is not needed.** Every slot outlet renders
`<div data-slot="<slotKey>" style="display:contents">` (@6186646), so
`[data-slot="conversation.input.model"]` could be targeted by CSS. This plan does
not hide anything, so the anchor is irrelevant here — noted only so the next
reader does not re-derive it.

**⑥ The session's preset is readable per session.**
`SessionBinding.session.projections.faceOf('agentPreset')` (`ProjectionsFace` is
part of the documented `sessions` client service); the shipped preset chip reads
the same value from the sessions store (`state.byId[id].projectionValues.agentPreset`).
Our ids are `acp-<agent>` ([`src/acp-agent/presets.ts`](../src/acp-agent/presets.ts)),
so `String(preset).startsWith('acp-')` is the test.

**⑦ `routable` has no consumer.** The directory computes `routable` and stores it;
across the whole shell there are four assignments and **zero reads**. So a
selection that is absent from the (filtered) catalog triggers no client-side
warning or submission gate, and the `llm` service contract says catalog membership
"does not constrain core routing".

## 3. The interception

Filter the data the card reads, per session, at the one call site both pickers
share. Nothing else changes.

```js
// src/client/model-scope.ts (pure) + the wiring in src/client/index.ts
const models = lookup(ctx, 'modelDirectories')          // optional; absent → do nothing
if (typeof models?.directoryFor === 'function') {
  const original = models.directoryFor.bind(models)
  models.directoryFor = (sessionId) => scoped(original(sessionId), sessionId)
  ctx.effect(() => () => { models.directoryFor = original }, 'session-map: acp model scope')
}
```

**The scoped façade** forwards everything to the original directory (via `Proxy`,
so an unknown future member still reaches it) and replaces only `store`:

```js
getSnapshot: () => cached(directory.store.getSnapshot(), isAcpSession(sessionId))
subscribe:   (fn) => directory.store.subscribe(fn)
```

- **Snapshot caching is load-bearing.** `ModelSelect` reads through
  `useSyncExternalStore`; a `getSnapshot` that returns a fresh object on every call
  makes React re-render forever. The façade memoizes on
  `(underlying snapshot identity, preset identity)` and returns the previous object
  when neither moved.
- **The filter is pure**, which is what makes it testable without a DOM:

```ts
filterGroups(snapshot, mode, isAcp): Snapshot   // src/client/model-scope.ts
```

- **The rule.** `scoped` (R2, the default): an ACP session keeps only groups whose
  `id === 'acp'`; every other session drops that group. `pinned` (R1, kept as a
  mode because it is one line): an ACP session keeps only `acp`, other sessions are
  untouched. `off`: today's behaviour.
- **Fail-open is the contract.** Anything unexpected — no service, no
  `directoryFor`, a missing `store`, a snapshot without `groups` — returns the
  original value untouched. The worst case of this feature is "the filter stops
  working", never "the composer breaks".
- **Reversible and local.** The patch lives in one `ctx.effect`; disposing the
  plugin fiber restores the original method. It is installed from the browser half
  only, and it never replaces a service or a slot.
- **No new dependency.** The façade does not need
  `@deepseek-ai/dsh-client-store`: `subscribe` is delegated to the real store and
  the filtered object is built in our own code, so `tsdown`'s client externals stay
  `react` + `react/jsx-runtime`.

**Where the mode lives.** A browser-local preference, alongside the existing
`CONVERSATION_VIEWS_KEY` in [`src/client/index.ts`](../src/client/index.ts): the
browser half is created by the web boot with a bare `{ name }`, so no row config
reaches it (the same reason P8's page reads its namespace from the Host instead).

## 4. Why not the alternatives

| Rejected | The measured reason |
|---|---|
| **Replace `conversation.input.model`** | The slot is `single` and the shipped component is not exported (31,827 chars). Replacing means reimplementing and maintaining the whole picker for every session — the user explicitly ruled this out. |
| **Drop the ACP group from the Host catalog** (`listModels('acp') → []`) | Removes ACP from *every* session including ACP ones; the card would then show DeepSeek models inside an ACP session. It also cannot express R2's first half, because `modelCatalog()` has no session. |
| **Add a second ACP control** (e.g. `conversation.input.right`) | Does not remove the ACP entries from the card, so it does not deliver R2; and it needs a data path for the model list. Kept in reserve only if the patch below proves impossible. |
| **Hide the card per session with CSS** (the `data-slot` anchor) | Works, but it hides the product surface instead of feeding it correctly, and it leaves the ACP session without any model control. Superseded by §3. |
| **Intercept `remote.session.modelCatalog()`** | It is a Remote, not a service: no interception point exists on the client. |

## 5. Steps

**Stage 0 — five device checks, before any code** (each is a browser observation
against a probe instance started with `--remote-debugging-port`, since none of
these can be proven headless):

1. `ctx.get('modelDirectories')` resolves from our client fiber, and
   `directoryFor` is a function on it. (Not in the Inspect Service catalogue —
   `no catalogued Service named "modelDirectories"` — so this must be observed, not
   assumed.)
2. Wrapping `directoryFor` changes what the card shows **immediately**, including
   after an HMR reload of our bundle.
3. `projections.faceOf('agentPreset')` yields `acp-<agent>` for a preset session
   and `undefined` for a plain one.
4. The filtered list renders without React's `getSnapshot should be cached`
   warning (the memoization in §3).
5. A selection that is filtered out of the list does not block sending a prompt
   (expected from ⑦; observed once).

**Stage 1 — the pure filter.** `src/client/model-scope.ts` +
`node --test` coverage, built as a Node entry like `acp-model` so it is testable
without a browser: filter by mode, group order preserved, empty result, snapshot
identity reuse, malformed snapshot passthrough.

**Stage 2 — the wiring.** Install the façade behind a feature-detect inside one
`ctx.effect` in [`src/client/index.ts`](../src/client/index.ts); read the mode from
the browser-local preference (default `scoped`).

**Stage 3 — browser verification and the record.**
`docs/p10-acp-model-scope.md` as a record (this file becomes its plan section), with
the visible evidence: a preset session's card listing only ACP models, a plain
session's card listing none, and `/model` behaving the same in both.

## 6. Tests and acceptance

- `pnpm typecheck` / `pnpm build` / `pnpm test` clean; the pure filter fully covered
  by `node --test` (no DOM, no product packages).
- **Regression line:** with the mode at `off`, the card is byte-identical to today
  — the patch still wraps the directory but the filter returns the same groups.
- With the mode at `scoped`: an ACP session's card and `/model` popup list only the
  ACP provider; every other session's list has no ACP group.
- Fail-open: with the service absent (or a deliberately malformed directory), the
  card behaves exactly as it does today and nothing throws.
- Disposal: unloading the plugin fiber restores `directoryFor` (asserted in the
  browser check by unloading and reopening the picker).

## 7. Risks, deliberate scope, open points

- **Unofficial surface.** This wraps `modelDirectories.directoryFor` and reads the
  `{ getSnapshot, subscribe }` shape of its store. Neither is a published API. That
  is why fail-open, reversibility and a re-run of the browser check after a product
  upgrade are part of the design rather than follow-ups.
- **Deliberate scope.** Only the two user-facing pickers are scoped. Settings →
  Models and the subagent model allow-list keep reading the true catalog.
- **Not covered here.** The blank-session Hero has no `sessionId`, so no directory
  exists yet; nothing is filtered until the Session exists — which is correct,
  because the preset is chosen on that very screen.
- **Resolved: the mismatch it would otherwise expose, in both directions.** In an
  ACP Session the projected *current* selection stays whatever the profile default
  was, while the list now shows only ACP — the product has always disagreed with
  itself here (a preset cannot carry a model route: `PresetDefinition` has no
  model, and the Session's selection is installed before the preset mounts).
  Option **(b) is implemented, symmetrically**: a Session whose preset names an
  agent is written onto that agent, and a Session that has *left* the agent — or
  never had one — is written back off it, because one direction alone would leave a
  Session routing to an agent its preset no longer asks for. The write is
  `session.selectModel({sessionId, provider, model})`, the same Remote the shipped
  picker uses, which the preset's own listener then passes through (P9).
  The selection a move displaces is remembered, so leaving the agent restores what
  the Session actually had; with nothing remembered (a profile whose *default* is
  an ACP model, for instance) the first model of another provider stands in.
  A decision settles **per preset value**, not once per Session — changing the
  preset is exactly the event this exists for — and it stays open rather than
  guessing when there is nothing to compare yet (a `null` before the catalog loads)
  or nowhere to move to (no other provider in the catalog). It never rewrites a
  selection that already agrees, including an inner model like `cursor::gpt-5`, and
  a refusal is reported once and abandoned rather than retried on every render. It
  does write Session state, which is the point: the composer ends up showing the
  model the preset implies.
- **Mode default.** `scoped` (R2) is the default this plan ships, with `off` and
  `pinned` (R1) available as preferences.

## 8. Reproduce the evidence

```powershell
# the shell the browser actually runs (10.5 MB, concatenated client bundles)
$tok = '<token from the running instance's banner>'
Invoke-WebRequest "http://127.0.0.1:3080/?token=$tok" -SessionVariable s -OutFile index.html
# then fetch every plugins/??… URL from index.html with -WebSession $s and grep for
#   modelDirectories.directoryFor / remote.session.modelCatalog / data-slot
```

Offsets cited above are byte offsets into that concatenated bundle and will move
with any product build; the identifiers (`modelDirectories`, `directoryFor`,
`ModelCatalogDirectory`, `ProjectionsFace.faceOf`) are the stable handles.

## 9. What shipped, and what is verified

**Files.** [`src/client/model-scope.ts`](../src/client/model-scope.ts) (new: the
pure filter, the mode preference, and the installer), one wiring block in
[`src/client/index.ts`](../src/client/index.ts), the `model-scope` Node entry in
[`tsdown.config.ts`](../tsdown.config.ts), and
[`test/model-scope.test.mjs`](../test/model-scope.test.mjs) (new). No Host file,
no product service, no slot and no stylesheet changed — this is the whole feature.

**Verified by the Node suite** (23 new tests, `pnpm test` at 61 passing /
1 skipped, `pnpm typecheck` and `pnpm build` clean). The installer is driven
against fakes, which is the only way to test a patch on another plugin's method
without a browser:

- the filter is right in all three modes and both Session kinds, and the ACP
  provider is matched by id;
- a list that loses nothing keeps its **object identity** (the
  `useSyncExternalStore` contract), and so does an unchanged read;
- a Session whose preset projection is missing or unreadable is **not** filtered
  (`unknown`), while a readable projection with no value is `other` — the
  difference that keeps a composition without presets from hiding ACP everywhere;
- a projection that lands *after* the first read re-scopes the list, and the
  subscriber is told;
- an unrecognized directory shape is returned untouched (fail-open);
- the wrap is memoized per directory and subscribes once, and disposal restores
  the original method and releases both subscriptions;
- the reconciliation (§7) writes `{provider:'acp', model:'<agent>'}` for a card
  Session whose selection is elsewhere and remembers what it displaced; **leaving**
  the agent writes that remembered selection back, and with nothing remembered it
  writes the first model of another provider; a restore with no other provider yet
  waits instead of guessing; it stays silent for a Session already on its agent
  (inner model included), for another agent's card, for a Session whose projection
  cannot be read, and for a runtime with no `selectModel` at all; and it reports a
  refusal once without retrying.

**Observed in the real browser** (Chromium 155, provider-owned launch against the
probe instance on port 3080, `data-slot="conversation.input.model"`):

- the plugin loads, the composer renders, and the seat's anchor resolves — the
  wrapper does **not** break the picker: the menu opens normally and no
  console/page error is recorded;
- the rendered menu differs between the two builds of `DEFAULT_MODEL_SCOPE`:
  `off` produced `menuitem "Model DeepSeek-V41-Flash"` **plus** an `Effort High`
  row and a display-name trigger, `scoped` produced a single
  `menuitem "Model deepseek-official/deepseek-flash"` with an id-form trigger.
  That difference proves the wrapper is installed and reaches the picker.

**Not verified at the time, and superseded below.** That difference is *not* by
itself the R2 outcome: the menu's accessibility tree exposes the root pane, whose
rows are the current selection and its effort, and the catalog loads asynchronously,
so a run that opens the menu before the load settles renders in the same minimal
shape. The provider list lives one click deeper, which is why the check below needed
a harness that can click *and* evaluate.

**Verified live.** A raw-CDP harness
([`../.dsh-dev/cdp-eval.mjs`](../.dsh-dev/cdp-eval.mjs) with
[`../.dsh-dev/exp-scope-both.js`](../.dsh-dev/exp-scope-both.js)) owns a headless
Chrome and evaluates inside the page, which the click-and-observe scenario tool
cannot do. It drives the hero's preset card and reads both the composer's model chip
and the picker's provider pane. On the shipped build:

- choosing `ACP · cursor` leaves the chip at `选择模型，当前 ACP · cursor` and the pane
  reads `ACP agents (Cursor, opencode, …)` — the agent, its `Auto` entry and all 44
  `ACP · cursor · <model>` entries, **with no other provider present**;
- switching to `标准模式` moves the chip back to `DeepSeek-V41-Flash` (High effort) on
  its own, and the pane lists `DeepSeek-V41-Flash` / `DeepSeek-V4-Pro` — **no ACP
  entry** (measured on the build whose only difference was the diagnostic markers).

P9 was confirmed in the same harness: the unfiltered pane lists `DeepSeek-V41-Flash`,
`DeepSeek-V4-Pro`, `ACP · cursor` and the 44 inner models, and the Session log records
`agent-preset/selected acp-cursor` / `standard` / `ptc` for the cards.

Four real causes were found and fixed on the way. Each had left the whole feature
silently inert, and the last one is the reason this section exists:

1. The preset is not at `projections.faceOf('agentPreset')`; that key does not exist.
   The product reads `sessions.list.getSnapshot().byId[id].projectionValues.agentPreset`,
   and that is what the wiring reads now.
2. `ctx.get(name)` **throws** inside a Cordis inject scope for any name the scope did
   not declare (`cannot get property "remote.session" without inject`), and Cordis
   swallows what an inject callback throws — so the block died at its first lookup
   without a warning anywhere. The wiring now declares exactly what the shipped
   picker declares (`modelDirectories`, `remote`, `remote.session`), reads them as
   scope properties, resolves the sessions store from the plugin context, and wraps
   the body so a future failure is reported instead of vanishing.
3. Patching `directoryFor` by assignment can fail on a read-only service view, so the
   patch tries the prototype as well and verifies each arm by reading the value back.
4. The install had to be *observed*, not assumed: `document.documentElement.dataset`
   was used as a marker because the CDP console channel of this target delivered
   nothing. That marker is gone from the shipped build.

The 30-second check in a real window (the probe instance serves the shipped build):

1. Open <http://127.0.0.1:3080/> and, in a plain new Session, open the model card.
   Expected: the ACP provider is absent.
2. Start a Session from the `ACP · cursor` preset card, then open the model card.
   Expected: only `ACP · cursor` and its models. If both cases look identical to
   the unfiltered list, the wrapper is not reaching the picker in that build and
   §4's reserve option (an additive control fed by `llm.discoverModels`) is next.

