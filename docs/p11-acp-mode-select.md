# P11 — an ACP mode control in the composer

**Date:** 2026-10-14 · **Status:** shipped and verified live through the command
channel; §7 records the seam that would make it quiet
**Builds on:** [P2](p2-preset-cards.md) · [P9](p9-agent-model-list.md) · [P10](p10-acp-model-scope.md)
**Request of record:** switch the agent's own collaboration mode
(`plan` / `agent` / `ask`) *inside* a Session, from a control in the composer tool
row, to the right of the access-mode (permission) select — and specifically *not*
buried in the composer's `+` menu.

## 1. Why this is not DSH's plan mode

DSH ships a plan mode (`dsh-plan-mode` + `dsh-client-ui-plan`), and its chip already
sits in that tool row — but it cannot drive a remote ACP agent. Its mechanism is a
**DSH prompt section** (`plan:policy`) plus a **DSH tool** (`exit_plan_mode`), with
the logged `plan/mode` event as its state. An ACP agent receives none of that: it
sees the conversation through its own harness, and the tool it would have to call is
DSH's, not its own.

An ACP agent instead advertises **its own modes** in `session/new`, and ACP defines
`session/set_mode` to change them — a core protocol method, not a vendor extension.
`cursor-agent` advertises exactly the three the request named (probed 2026-10-14,
capability-independent):

```json
{"currentModeId":"agent","availableModes":[
  {"id":"agent","name":"Agent","description":"Full agent capabilities with tool access"},
  {"id":"plan","name":"Plan","description":"Read-only mode for planning and designing before implementation"},
  {"id":"ask","name":"Ask","description":"Q&A mode - no edits or command execution"}]}
```

## 2. Placement

`conversation.composer.bar` declares its children in render order, and the run that
matters is:

```
conversation.input.permission   (single)  ← the access-mode select
conversation.input.left         (list)    ← "Compact controls at the left of the composer tool row"
conversation.input.plan         (single)
conversation.input.right        (list)
conversation.input.model        (single)
```

`conversation.input.left` is a **list** slot with `replaceRisk: none`, declared
immediately after the permission seat and empty before this phase. The cell is
registered there with `order: 0`, which is what puts it to that seat's right.

## 3. What shipped

- **`src/client/acp-mode-model.ts`** — the mode vocabulary, shared by both halves:
  reading ACP's `SessionModeState`, the report line's format, its parser, and the
  `[@agent] [mode]` command-line split. One definition, so the writer and the reader
  cannot drift.
- **`src/acp-agent/channel.ts`** — keeps the modes `session/new` advertised, exposes
  `modeState()`, changes them through `session/set_mode`, and no longer swallows
  `current_mode_update` (the update switch's `default:` arm used to absorb it). A
  configured `agents[].mode` is still applied at session start.
- **`src/acp-agent/modes.ts`** — the `/acp-mode` command and the surface behind it: a
  per-Session registry of live channels, and an in-memory record of a mode picked
  before the agent connected, which the first channel for that Session adopts before
  its prompt.
- **`src/acp-agent/adapter.ts`** — registers each Session channel with that surface,
  and exposes `modesFor(agent)` so a report can be answered for a Session that has no
  channel yet. It rides the model-list discovery handshake, deliberately *not* gated
  by `modelDiscovery`: a catalog read may skip spawning an agent, while someone asking
  this control what modes exist is asking for exactly that probe.
- **`src/client/acp-mode-card.ts`** — the control: one read per Session per page
  (`/acp-mode @<agent>`), a `<select>` built from the parsed answer, and a switch per
  change (`/acp-mode @<agent> <id>`). It renders nothing unless the Session's preset
  is one of this package's (`acp-<agent>`) and the agent advertises at least two modes.

## 4. The channel that is not available, and the incident it caused

The first design followed `dsh-plan-mode` exactly: append one log-only whole-value
event (`acp/mode`), fold it with a `sessionProjections` unit, and let the cell read
`useProjection('acpMode')`. Every part of that is a documented plugin seam — except
the event, which **broke the Session**:

```
SessionQueryError: session "session-20ef0868-…" contains event type "acp/mode" (seq 94)
unknown to this harness and not marked ignorable; refusing to interpret the log
```

`dsh-session`'s read path accepts a type outside the build's catalogue only when the
envelope carries `ignorable: true`, and the generated catalogue's own doc says the
rest: *"downstream plugin events are outside this list by construction; a
registration surface for them is deferred until such a consumer exists"*.
`Session.append(type, data)` takes no options for a non-surface event, so a plugin
cannot set that marker. The three other Host→client channels are equally closed:

| Channel | Status |
|---|---|
| A Remote namespace of our own (`@Remote` + `ctx.remote.<ns>`) | **Closed** — `dsh-api-remotes`: "the capability set is fixed by explicit build-time value imports". |
| A forwarded Host event (`ctx.remote.$on`) | **Closed** — `API_REMOTE_FORWARDED_EVENTS` is a build-time allowlist. |
| A custom Session event + `sessionProjections` unit | **Closed** — no registration surface for out-of-repo types. |
| A **registered command** (`ctx.commands.register` + `remote.commands.execute`) | **Open** — and it is what the shipped plan chip uses for its own write. |

**Damage control, recorded.** One Session log was affected (this repository's probe
profile); the 75 logs in `~/.dsh` were untouched. It was repaired in place — the
event's envelope now carries `ignorable: true`, only the one frame holding it was
re-encoded, every other frame's bytes were copied through, and a timestamped `.bak-`
sits beside it. The tool is `.dsh-dev/repair-session-log.mjs` (`--scan`, dry run by
default). The append path was then removed from the code.

## 5. Verified

- **Unit** (`pnpm test`: 69 tests, 68 passing, 1 skipped): the mode read, the report
  format and its parser (including a name containing a separator), the command-line
  split, the grammar's three outcomes, the live switch, the refusal path, a report
  answered by the route probe with no channel, and the held-then-adopted pick.
- **Live**, over raw CDP against the running instance: the control appears in the
  composer to the right of the access-mode select, *before the Session's first
  message*, offering the agent's own modes —
  `{"cell":true,"before":{"value":"agent","options":["agent:Agent","plan:Plan","ask:Ask"]}}`
  — and switching it settles:
  `{"after":{"value":"plan","title":"ACP mode","disabled":false},"changed":true}`.
- **Durably**, in the Session log: the flow is recorded as known events only —
  `command/run` + `command/done` naming `acp-mode`, with the switch reported as
  `ACP mode: plan (applies when the agent connects)` — and **no `acp/mode` event
  exists** (`unknown acp/mode present: false`).

## 6. Known costs of this channel

- Each read and each switch commits the command's own lifecycle events, which the
  transcript renders as a command row. The cell therefore reads **once per Session per
  page** (a failed read is forgotten so a later mount may retry).
- `acp-mode` stays listed in the composer's `+` Command menu: the command registry has
  no hidden flag. It is also a power-user path — `/acp-mode @cursor plan` works from
  the input box.
- The first read of a Session whose agent has not connected spawns one discovery
  handshake (~10s), which the model catalog usually triggers anyway. P12 cut the
  avoidable part of that wait: the read returns when `session/new` answers instead
  of six seconds later, a previously successful answer is served immediately and
  re-read behind the read, a waiter's own deadline is no longer replaced by a
  background probe's, and a Session that connects feeds the cache for the next
  reader.

## 7. Decision, and the alternatives that were measured

**Decision (2026-10-14): keep the command** (§3–§6). The two cost-free designs each
need something this project is not ready to pay, and both were measured rather than
assumed:

1. **Mark the event `ignorable` upstream.** `dsh-session` would have to let a log-only
   append carry the marker (or ship the registration surface
   `2026-08-30-retain-ignorable-external-session-events.md` anticipates). That fixes
   the **read** — the projection design in this phase's history works unchanged — and
   it changes nothing about the **write**, which still needs a command, so the menu
   entry and the command rows would both remain.
2. **A generic per-Session option Remote** (or making Remote namespaces registrable at
   runtime, which is what a plugin would need for a namespace of its own). This is the
   only upstream design that removes both costs, and it is a platform change rather
   than a bug fix.
3. **The settings namespaces** — the one channel that is quiet and needs no upstream
   change. `dsh-api-settings-controller` exposes `settings.describe()` (every
   namespace, including a plugin's own) and `settings.update|replace|mutate`, and
   `settings/document-updated` is on the forwarded-event allowlist, so a plugin-owned
   namespace is a client-readable, client-writable, live-notified channel: the control
   could read the agent's advertised modes from it and write the pick back, with no
   command, no menu entry and no transcript rows. Its price is that runtime state
   lands in the user's `settings.yaml` under a plugin-owned namespace (one entry per
   configured agent, plus one session entry pruned the moment the mode is adopted),
   and a read of what modes exist would either wait for the route's own discovery or
   ask for a probe through the same document. Declined for now; recorded here because
   it is the shortest path to a quiet control if the command's visibility ever becomes
   the deciding factor.

Until one of those lands, the command answer is the only state channel a runtime
plugin has, and the costs in §6 are the price of the control existing at all.
