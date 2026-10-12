# P3 record — lifecycle, cancellation, and the utility routes

**Date:** 2026-10-12 · **Status:** cancellation and utility delegation proven;
reaper and crash recovery await a live interactive Session
**Builds on:** [P0](p0-spike.md) · [P1](p1-acp-route.md) · [P2](p2-preset-cards.md)

## What P3 delivers

| Change | Why it was needed |
|---|---|
| **Cancellation actually cancels** | `channel.next()` awaited the queue unconditionally, so the Host's stop signal was only observed when the remote agent happened to emit something else — the exact hang a stop button exists to end |
| **Waiting respects the Host signal** | The mirror tool awaited the remote outcome with no abort arm, so a cancelled turn left a `tool/result` pending until the agent finished anyway |
| **Per-turn queue reset** | An aborted turn can leave stale updates and an unconsumed `settled` behind; replaying them into the next turn would attribute one turn's output to another |
| **Idle reaper** | One agent process per (Session × agent) accumulates for the life of the profile; nothing else in the Host knows a Session went quiet |
| **Structured, non-leaking failures** | Failures now surface as a fixed line naming agent, stage and category; stderr, paths and protocol payloads stay on the cause chain for the Host log |
| **`utilityProvider` / `utilityModel`** | Compaction and session titles reuse the Session's route. The remote agent's own context has nothing to do with summarising this one, so P1 declined them. Now they can be delegated to a real model |

New config on the `acp-agent` row: `idleDisposeMs` (default 10 minutes, 0
disables), `utilityProvider` + `utilityModel` (all-or-nothing — a provider
without a model would silently borrow a sibling route).

## Verified

**Cancellation returns promptly** (`.dsh-dev/abort-probe.mjs`, against the built
artifact, constructing a real `AcpChannel` that spawns nothing):

```
wait outcome: "aborted" after 51ms          (the abort fired at 50ms)
a cancelled wait returns promptly: YES
an already-aborted signal returns: "aborted"
```

**Utility delegation runs** — with `utilityProvider: spike`, the session title
was produced through the delegated route:

```
14 session/title-llm-request  route: {provider: acp, model: cursor}
15 session/title              title: "spike:session-title"
                              source: {kind: provider, model: {provider: acp, model: cursor}}
```

`spike:session-title` is the scripted adapter's own output, so it can only be
there because `delegate()` re-dispatched the request.

**The decline path still stands** — with no utility route configured, the same
request keeps the Host's own pre-request fallback:

```
session/title  title: "Create a file named p3-probe.txt"  source: {kind: fallback}
```

**No regression** — a real Cursor Session still creates its file, still returns
its answer, still records an `acp_edit` tool call with the remote diff as its
result; `pnpm typecheck` is clean and `pnpm test` stays at 46 passing / 1 skipped.

## Not verified automatically, and why

- **The reaper's timing** needs a long-lived profile with a live Session; the
  headless app exits as soon as its task settles, taking every channel with it.
  The mechanism is a single `setTimeout` armed on handshake and on each turn,
  cleared on dispose, and `unref`'d so a parked channel cannot hold a process open.
- **Recovery after the ACP process dies mid-conversation** — the adapter already
  treats an unusable channel as "dispose and build a fresh one", and a dead
  process marks its channel broken, but the *remote* session's context is gone
  when that happens. The Host transcript survives; the remote agent restarts from
  nothing. `session/load` would be the fix and is not implemented.
- **The stop button end to end** — the probe proves the wait ends, and the browser
  check below is what proves the whole path.

## Browser check

The probe instance runs from `.dsh-dev/scratch`. The default model is still the
scripted P0 adapter, so an ACP card is the only way to reach Cursor:

1. New Session → select the **ACP · cursor** preset card.
2. Ask for something slow enough to interrupt, e.g. *"write a short poem about
   sandboxes, then create p3-web.txt with it"*.
3. Press **stop** mid-turn. Pass = the turn ends promptly, no tool card is left
   spinning, and no `cursor-agent` process survives the stop.
4. Then run one task to completion to confirm nothing regressed.

## Reproduce

```powershell
node .dsh-dev/abort-probe.mjs          # cancellation
node .dsh-dev/preset-order-probe.mjs   # preset route pinning (P2)
dsh --profile spikeh "…"               # end-to-end ACP conversation
```
