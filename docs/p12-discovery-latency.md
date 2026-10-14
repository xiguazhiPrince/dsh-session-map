# P12 — making the ACP mode and model reads answer when the handshake does

**Date:** 2026-10-14 · **Status:** shipped; the saved latency is measured on this
machine, the browser half of the model-list fix is verified against the product
bundle rather than in a browser (see §6)
**Builds on:** [P9](p9-agent-model-list.md) · [P10](p10-acp-model-scope.md) · [P11](p11-acp-mode-select.md)
**Request of record:** "the ACP mode and the ACP model take so long to load — fix it
at the root, not in the config."

## 1. What was measured, before and after

ACP has no "list modes" and no "list models" call: both arrive only in the
`session/new` result. Every read is therefore gated behind a spawn + `initialize` +
`session/new`, and the only honest way to know what that costs is to time it. The
probe ([`.dsh-dev/scratch/timing-probe.mjs`](../.dsh-dev/scratch/timing-probe.mjs))
drives the real `AcpAgentAdapter` over the real `cursor-agent` and taps the wire.

| | before | after |
|---|---|---|
| `initialize` answered | 1.03 s | 1.20 s |
| `session/new` answered | **8.64 s** | **7.77 s** |
| child exited | 14.70 s | (not on the read's path) |
| **`modesFor('cursor')` returned** | **14,704 ms** | **7,772 ms** |

The interesting number is the last two rows: the answer was in hand at 8.64 s and
was handed over at 14.70 s. **Six seconds of every cold mode read were teardown, not
discovery** — `probe()` awaited `channel.dispose()`, which ends stdin and then waits
`disposeEofGraceMs` (6000 ms by default) for a real agent to finish flushing. The
same wait sat on every `eager` catalog read, and on every waiter that joined a
probe.

The rest of the handshake is the remote agent's own cost and stays. `session/new` is
7–8 s here because `cursor-agent` initializes its session services there; P9 measured
five of them at 7.2–14.2 s with one 37.6 s outlier.

## 2. The five defects this phase removes

1. **Teardown was on the critical path.** `probe()` recorded its result and then
   awaited `channel.dispose()` before settling — so a caller got an answer that had
   been ready for six seconds.
2. **A waiter's deadline was silently discarded.** `discover()` returned the
   in-flight promise unchanged, ignoring the `timeoutMs` of the second caller. The
   mode control asked for `discoveryTimeoutMs` (15 s) and could inherit the
   background probe's 60 s.
3. **A stale result was withdrawn, not revalidated.** Past `discoveryTtlMs` the
   entry stopped being used, so the catalog dropped back to the legacy
   `ACP · <agent>` entry and the mode control went back to a full handshake — while
   the previous, perfectly good answer sat in the cache.
4. **A connected Session's handshake was thrown away.** A conversation channel
   learned the same `session/new` facts as a throwaway probe and published none of
   them, so the next Session paid for the same discovery again.
5. **A `lazy` probe's result could never reach the browser.** The shipped default
   answers a catalog read immediately (legacy entry only) and warms the cache in the
   background — but the client caches **one catalog per host generation** and only
   re-reads it on `connection/reset`, `llm/adapters-updated`,
   `settings/document-updated` or a credential event. Nothing emitted any of those
   when the probe finished, so the 44 inner models `cursor-agent` advertises stayed
   invisible for the lifetime of the page. This is the "ACP model loads slowly"
   report: it was not slow, it was unreachable. P9 filed it as
   *"whether the picker re-reads the catalog while the page is open"*; the product
   bundle now answers it — `ModelCatalogDirectory.load()` returns the cached value
   while `status === 'ready'`, and only `invalidate()` re-reads.

## 3. What changed

| File | Change |
|---|---|
| [`src/acp-agent/adapter.ts`](../src/acp-agent/adapter.ts) | `probe()` records its answer, **starts** teardown (`detachDispose`) and returns; `dispose()` awaits the tracked teardowns so the row still reaps every process. `discover()` is always created with the background bound and each caller bounds itself (`settleWithin`), so a waiter's deadline is its own. `listModels`/`modesFor` serve a stale success and revalidate behind it. A ready Session channel seeds the cache (`recordLive`). A changed model selector announces a catalog refresh (`announceModels`). |
| [`src/acp-agent/contract.ts`](../src/acp-agent/contract.ts) | The optional `llm.emitAdaptersUpdated()` notification, with its provenance. |
| [`src/client/acp-mode-card.ts`](../src/client/acp-mode-card.ts) | The cell says `ACP…` while it waits instead of rendering nothing for the length of a handshake. |
| [`src/client/css.ts`](../src/client/css.ts) | The waiting placeholder, matching the control's compact weight. |
| [`test/mock-acp-agent.mjs`](../test/mock-acp-agent.mjs) | Two scenarios: `linger` (ignores stdin EOF for a window, like a real agent) and `delay-new-session` (a slow `session/new`). |
| [`test/discovery-latency.test.mjs`](../test/discovery-latency.test.mjs) | Six tests, one per property in §4. |

The announce is the one change that reaches outside this package, so it is
deliberately narrow: the fingerprint covers the model selector's values only (a
`currentValue` that moved because a Session picked something is not a catalog
change), an agent that advertises no selector never announces, and an unchanged
selector never announces twice. The dispatcher is the LLM service's own
`emitAdaptersUpdated`, whose listeners are already individually error-isolated by
the product, and it is feature-detected — a composition without it leaves the
route's behaviour exactly as it was before this phase.

## 4. Verified

`pnpm typecheck` and `pnpm build` clean; `pnpm test` **74 passing / 1 skipped**, six
of them new. Each new test names the property it protects:

- a cold read answers when the handshake lands, not when the child exits — with a
  child that lingers 2000 ms past its EOF window, the read returns in <1500 ms, the
  record file has **no exit entry yet**, and `dispose()` still waits for it;
- a waiter's own bound applies even to a probe someone else started, and a waiter
  that gives up does **not** cancel it (the next read finds the recorded answer);
- a result past its TTL is served while it is re-read behind the read;
- a connected Session seeds the cache: the turn is the only process spawned, and
  neither the catalog read nor the mode read starts a second one;
- a changed model list announces exactly one catalog refresh — and stays silent on
  a fresh cache read and on a Session that advertises the same selector;
- nothing is announced when there is nothing new to list (no selector, or an
  unreachable agent).

The live numbers are §1. The wire timeline `modesFor` now shows has no `child
exited` mark before it returns, which is the whole finding.

## 5. Deliberately not changed

- **The handshake itself.** `initialize` + `session/new` is 7–14 s of remote agent
  work and ACP offers no cheaper form. What this phase removes is everything the
  route added on top of it.
- **The `lazy` default.** With the announce in place, `lazy` is now what it was
  meant to be: no caller ever waits, and the inner models still appear a few
  seconds later without anyone touching Settings. `eager` remains a choice for a
  deployment that would rather block the first catalog read.
- **The two-process shape.** A Session channel and a discovery probe are still
  separate processes; a Session that connects now *feeds* the cache, but nothing
  yet makes the probe reuse a Session's channel, which would need a lifetime this
  route does not own.
- **The command channel for modes** (P11 §7). This phase makes reads cheap; it does
  not make them quiet.

## 6. What is not verified here

- **The browser's reaction to the announce.** That the product re-reads its catalog
  on a forwarded `llm/adapters-updated` is read out of the shipped bundle
  (`API_REMOTE_FORWARDED_EVENTS` carries `{ event: 'llm/adapters-updated', mode:
  'emit' }`; `ModelDirectoryResolver` subscribes to it and calls
  `catalog.refresh()`; the LLM service's `emitAdaptersUpdated()` dispatches exactly
  that name and is a method of the same class this route already calls
  `registerAdapter` on). The call itself is unit-tested. The visible outcome — an
  ACP Session's picker filling in with the inner models a few seconds after startup,
  with no reload — is a browser observation and is the first thing to check after
  restarting the profile.
- **The mode cell's loading state** is covered by typecheck and the bundle build,
  not by a DOM test; this repository has no DOM test harness by design.

## 7. Reproduce

```powershell
# the saved latency, against the real agent (needs a logged-in cursor-agent)
node .dsh-dev/scratch/timing-probe.mjs
#   A. modesFor(real) = <handshake> ms   ← was handshake + disposeEofGraceMs
#   B. inner models appear on read #N after <handshake> ms

# the properties, without an agent
node --test test/discovery-latency.test.mjs
pnpm typecheck; pnpm build; pnpm test
```

After a `pnpm build`, an installed copy has to be updated too: this package ships
prebuilt `lib/`, and the profile that runs it installs from GitHub, so a rebuilt
`lib/` only reaches a running instance by reinstalling the commit (or by replacing
the profile's `node_modules/dsh-session-map/lib/`). The host half then needs the
profile's process restarted and the browser half a page reload.
