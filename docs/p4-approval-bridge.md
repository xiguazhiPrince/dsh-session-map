# P4 record — the approval bridge

**Date:** 2026-10-12 · **Status:** bridge and fallback proven against the scripted
agent; the live grant awaits the browser check
**Builds on:** [P0](p0-spike.md) · [P1](p1-acp-route.md) · [P2](p2-preset-cards.md) · [P3](p3-lifecycle.md)

## What P4 delivers

A new row field, `approval: 'ask' | 'policy'` (default `policy`):

- **`policy`** — the shared core's behaviour: each agent's
  `permission` setting auto-answers, and the Host's approval service is never
  consulted.
- **`ask`** — an ACP `session/request_permission` becomes a Host approval
  request. It is audited in the Session's own log, applies that Session's
  approval policy, and puts the question in the Session's conversation, so the
  person who started the Session decides instead of a config value deciding for
  them.

This is the change that removes the caveat the README has carried since P1:
"the remote agent's tools run unattended".

## How the decision travels

```
ACP agent ──session/request_permission──▶ channel.answerPermission()
                                             │  approval: policy → decidePermission() (unchanged)
                                             └─ approval: ask
                                                  ├─ ctx.get('approval').request({ agent, toolName, callId, reason, signal })
                                                  │     ↳ applies Session policy, appends approval/asked + approval/decided
                                                  └─ outcome → the agent's own option vocabulary
                                                       allowed-once → allow_once  (allow_always only if none)
                                                       rejected     → reject_once (reject_always only if none)
                                                       cancelled    → { outcome: 'cancelled' }
                                                       unavailable  → the row's `permission` policy
```

Three details are deliberate:

1. **`toolName` is the same string the conversation's tool card shows**
   (`acp_execute`, not `execute`), so an approval and the call it belongs to
   cannot read as two unrelated things.
2. **A grant prefers `allow_once`.** Answering one prompt must not widen the
   remote agent's own persisted permission state as a side effect.
3. **`reason` is the remote agent's own title**, which is already visible on the
   tool card; the approval adds an answer, not new information.

## Verified: the bridge runs, and the fallback is the documented one

The remote agent is the repository's **scripted** ACP agent in its `permission`
scenario (`test/mock-acp-agent.mjs`) — deterministic, no login, no network, no
guessing about whether a given Cursor version prompts. It records the client's
answer into `MOCK_ACP_RECORD`, and the Host records the ask in the Session log.

| `approval` | `permission` | Session-log audit | Answer recorded by the agent |
|---|---|---|---|
| `ask` | `reject` | `approval/asked` + `approval/decided` (`unavailable`) | `{outcome: cancelled}` |
| `ask` | `allow` | `approval/asked` + `approval/decided` (`unavailable`) | `{outcome: selected, optionId: opt-once}` |
| `policy` (default) | `allow` | none (only `approval/policy`) | `{outcome: selected, optionId: opt-once}` |

The third row is the control: the default mode is behaviourally identical to the
pre-P4 route. The first two prove the ask really reaches the Host service (the
audit pair exists at all) and that an unroutable ask falls back to the row policy
rather than inventing a grant.

The recorded ask carries exactly what this row chose to send:

```json
{"type":"approval/asked","data":{"toolName":"acp_execute","reason":"Run a command"}}
{"type":"approval/decided","data":{"outcome":"unavailable"}}
```

## Not verified automatically, and why

- **The grant path itself** (`allowed-once` → `allow_once`). Answerers register on
  an Agent-scoped Cordis waterfall and none ships with a headless composition, so
  the probe can only reach `unavailable`. That mapping is six lines over the same
  option vocabulary `src/acp-core/client.ts` already uses, but it is proven by the
  browser check below, not by this record.
- **Whether a given Cursor version prompts at all.** The bridge is only as
  visible as the remote agent's willingness to ask. The scripted agent exists in
  this profile precisely so the feature can be exercised regardless.

## Browser check

The probe instance runs from `.dsh-dev/scratch`, with the **scripted** agent as a
second ACP agent (`ACP · mock`) and the picker's saved default already pointing at
it, so a brand-new Session reaches the approval prompt immediately:

1. New Session (the preset card should read **ACP · mock**) → send anything.
2. An **approval card** should appear in the conversation asking to allow
   *Run a command*, and the turn should wait.
3. Approve once → the turn continues and `acp_execute` appears as a tool card.
4. Start another Session and **reject** → the agent is told the call was refused
   and the turn still settles.

`.dsh-dev/mock-record-web.jsonl` records what the agent received, so the answer
can be checked from outside the UI as well.

## Correction: the tool-card title is NOT the host's `presentCall`

An earlier claim in conversation was wrong, and the code says why. The browser's
tool row is built client-side by `toolRowModel`:

```
titleKey = toolTitleKey(toolName)                       // a fixed locale-key table
summary  = [titleKey === 'tool.title.generic' ? toolName : '', base].join(' · ')
```

So the row's title is a **locale key chosen from the tool name**, and its summary
is derived client-side from the raw arguments. An unknown tool name (ours) falls
to `tool.title.generic`, which is why the card reads
`工具调用 · acp_read · session-…::mock#1`: tool name, then a client-derived
summary, and no host presentation anywhere in the path. `ToolCallTree`'s fallback
is `<GenericToolCard {...owner} />` where `owner` is the client's own call block.

The host-side `presentCall` added alongside P4 is still correct for what it is —
a host render intent, which the CLI/TUI rendering path consumes — but it does
**not** reach this card, and the `ToolCallKind`/`locations` it carries are
therefore not visible either.

Making our rows readable in the web UI needs a **client-side**
`tool.call.toolview` registration for the `acp_*` keys. That key domain is open
by design (`open: any string the owner dispatches`), so it is the sanctioned
route — it is simply more work than a host-side presenter, and it can only be
checked by looking at the rendered page.

## Reproduce

```powershell
$env:DSH_HOME = "$PWD\.dsh-dev"
$env:DEEPSEEK_API_KEY = 'spike-dummy-key'
dsh --profile approval "say hi"       # scripted agent + approval: ask
node .dsh-dev/dump-events.mjs <newest session.v4.jsonl.zstd> | Select-String approval/
```
