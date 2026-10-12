# P1 record — the conversational ACP route

**Date:** 2026-10-12 · **Status:** host half proven against a real agent; browser
check pending · **Builds on:** [P0 spike record](p0-spike.md)

## What P1 delivers

`dsh-session-map/acp-agent` — a root-scope row that turns a remote ACP CLI agent
into a **model route** (`provider: acp`, one model per configured agent). A new
DSH Session selects it like any other model, and the whole conversation —
reasoning, text, and every remote tool call — lands in the shipped Chat UI with
no product changes and no second conversation surface.

| File | Role |
|---|---|
| [`src/acp-agent/index.ts`](../src/acp-agent/index.ts) | Plugin entry: resolves the shared `agents` config, registers the route at root scope, owns disposal, re-syncs on volatile edits |
| [`src/acp-agent/adapter.ts`](../src/acp-agent/adapter.ts) | The `LlmAdapter`: model catalog, channel pool, input selection, and the chunk stream |
| [`src/acp-agent/channel.ts`](../src/acp-agent/channel.ts) | One persistent ACP channel: process, handshake, remote session, update queue, open tool records |
| [`src/acp-agent/tools.ts`](../src/acp-agent/tools.ts) | The mirror tools: one per ACP tool kind |
| [`src/acp-agent/contract.ts`](../src/acp-agent/contract.ts) | Duck-typed seam views plus the P0 findings each shape encodes |

Taken from the shared ACP client core in `../acp-core`: `resolveAcpCommand`,
`resolveChildCwd`, `decidePermission`, `disposeAcpChild`, and the blocking /
notification extension-method tables. (At the time of P1 these lived in a
delegation driver that has since been removed — see [P7](p7-remove-delegation.md).)

## The turn model, which is the whole design

ACP runs a **whole turn** per `session/prompt` and reports one `stopReason` at
the end; the Host expects a model call to **end at each tool call** so it can
execute that call and continue. P1 reconciles them like this:

1. The Host's step calls `stream()`. On a fresh turn the adapter sends the user
   text as `session/prompt` and deliberately does not await it.
2. Remote updates arrive as `agent_message_chunk` / `agent_thought_chunk` and
   are streamed as `text-delta` / `reasoning-delta` **live**.
3. The first **newly seen** `tool_call` update is emitted as a `tool-call-delta`,
   and the stream ends with `finish: {kind:'tool-calls'}`. The remote turn keeps
   running in the background.
4. The Host executes the mirror tool. Its `execute` awaits that record's
   settlement, so the resulting `tool/result` carries the remote agent's real
   output — including diffs.
5. The Host calls `stream()` again; the adapter resumes the same queue and emits
   the next segment, or the terminal `finish` when the prompt settles.

Safety property: the channel **releases every open record** when the prompt
settles or fails, so a remote agent that ends its turn with a tool call still in
flight cannot hang a mirror tool.

## Verified evidence

Real `cursor-agent` (2026.10.01) against a headless Session, task: *"Create a
file named p1-probe.txt … then reply with the single word done."*

```
11 request/header {"provider":"acp","model":"cursor","reason":"initial"}
15 assistant/message step 1: [reasoning(Creating p1-probe.txt …),
                              text(I'll create `p1-probe.txt` …),
                              tool-call(acp_edit … {"title":"Edit File","kind":"edit"})]
16 tool/call   {name:"acp_edit", arguments:"{…\"title\":\"Edit File\",\"kind\":\"edit\"…}"}
17 tool/result {isError:false, content:"…--- C:\\…\\scratch\\p1-probe.txt\n- …"}
20 assistant/message step 2: [reasoning(I will create the file …), text(done)]
22 turn/end {"reason":"completed"}
```

`p1-probe.txt` was really created (16 bytes), the answer was `done`, no
`cursor-agent` process was left behind after the run, and `pnpm test` still
passes 46/1-skipped. The tool result carries Cursor's **diff content**, which is
the payoff of the mirror-tool design: the card has a real outcome, not a
placeholder.

## Findings that shaped the code, and what they cost

1. **"The last user message" is not the user's input.** The Host appends its
   runtime context (`source.form: 'snapshot'`) and skill catalog
   (`source.form: 'catalog'`) as user-role messages *after* the real input. The
   first working version forwarded the skill catalog and Cursor answered
   *"The user sent a system reminder … but no actual task"*. Input selection now
   requires `kind: 'user'` with no `form` (or no `source` at all, the shape of a
   freshly admitted prompt).
2. **Utility calls are declined, and that is correct.** `session/title` and
   compaction reuse the Session's route. The adapter refuses them with
   `acp/unsupported-purpose` rather than forwarding them to an agent whose own
   context has nothing to do with summarising this one. Verified: the durable
   title keeps `"source": {"kind":"fallback"}` and reads
   *"Create a file named p1-probe.txt"*. **Compaction remains unhandled** — a
   long ACP conversation will not compact, and the decline surfaces as a failed
   request. P3 must delegate `purpose` calls to a configured real model.
3. **Tool-call arguments are a snapshot.** The chunk is emitted when the call is
   announced, so fields that only arrive in a later `tool_call_update` (notably
   `rawInput`, observed empty for Cursor's edit) reach the **result**, not the
   arguments. The title and kind are present, so the card is still legible.
4. **A model choice is persisted by patching the profile, not settings.** The
   Host's `agentDefaultModel.saveSelection` writes an `agent-default-model` row
   into the profile's `cordis.patch.yml`. That is how the probe routes a headless
   run at the ACP agent, and it is worth knowing before P2 assumes otherwise.
5. **New bundle rows must be overridden by id, never inserted.** A profile patch
   that `insert`s a second row with an id the bundle already declares collides;
   `- id: acp-agent` + `disabled: false` is the working form.

## Deliberate scope of P1

- **Read-only mirror.** The route declares `clientCapabilities: {}` — no `fs/*`,
  no `terminal/*`. The remote agent self-serves; DSH's sandbox and approval flow
  do **not** apply to it. Declaring a capability without implementing it would be
  worse than declaring none. (P6 later implemented `fs/*` for real and made it
  opt-out; see [P6](p6-fs-bridge.md).)
- **Permissions auto-answered** by the row's `allow`/`reject` policy. (P4 later
  made asking the Host an option; see [P4](p4-approval-bridge.md).)
- **One process per (Session × agent)**, kept alive across turns, disposed on
  row unload. No idle reaper yet; no `session/load` on resume, so a Host restart
  starts a fresh remote session and the remote agent loses its own context while
  the Host transcript is preserved.

## Reproduce

```powershell
$env:DSH_HOME = "$PWD\.dsh-dev"
$env:DEEPSEEK_API_KEY = 'spike-dummy-key'   # only so headless startup finds a key for its own default route
dsh --profile spikeh "Create a file named p1-probe.txt containing exactly: hello from acp"
node .dsh-dev/dump-events.mjs <newest session.v4.jsonl.zstd>
```
