# P6 record — the filesystem bridge (step B)

**Date:** 2026-10-12 · **Status:** verified against a scripted agent, including the
sandbox fence
**Builds on:** [P0](p0-spike.md) · [P1](p1-acp-route.md) · [P2](p2-preset-cards.md) · [P3](p3-lifecycle.md) · [P4](p4-approval-bridge.md) · [P5](p5-client-tool-views.md)

## What step B delivers

A new row field, `fs: 'bridge' | 'isolate'` (default `bridge`):

- **`bridge`** — the handshake advertises `clientCapabilities.fs`
  (`readTextFile`, `writeTextFile`), and the corresponding requests are served
  through **`ctx.fs`**. A remote `fs/write_text_file` is therefore an ordinary
  Host write: the filename resolves in this Session's execution world, the write
  carries the Session's **resolved sandbox policy**, and the sandbox refuses it
  when the Session is read-only.
- **`isolate`** — advertises nothing, leaving the agent to its own filesystem.
  This is what every phase before this one did.

Until now the route advertised `clientCapabilities: {}`, which was correct while
nothing implemented those methods: the P1 note said advertising a capability the
driver does not implement is how an agent is made to read empty files. That is
still the rule — the capability is advertised only when `bridge` mode is
configured **and** the Host service exists.

| File | Role |
|---|---|
| [`src/acp-agent/channel.ts`](../src/acp-agent/channel.ts) | Capability advertising, `readTextFile`/`writeTextFile`, policy resolution |
| [`src/acp-agent/config.ts`](../src/acp-agent/config.ts) | The `fs` field |
| [`src/acp-agent/contract.ts`](../src/acp-agent/contract.ts) | The `fs` and `sandboxPolicy` seam views |

## Verified

The remote agent is the repository's **scripted** agent in a new `fs` scenario
(`test/mock-acp-agent.mjs`): it asks the client to read one real workspace file
and write another, and records both answers. Two runs, same profile, different
deployment sandbox mode:

| Deployment mode | `fs/read_text_file` | `fs/write_text_file` | File on disk |
|---|---|---|---|
| `workspace-write` (default) | `{content: "the host filesystem served this line"}` | `{}` | present, with the written text |
| `read-only` | `{content: "…"}` | error `file access denied under read-only mode` | **absent** |

The second row is the whole point: the refusal comes from the **Host backend**,
not from the agent's cooperation. A read stays legal in read-only mode, and the
write is stopped with the file never created.

`pnpm typecheck`, `pnpm build` and `pnpm test` (46 pass / 1 skipped) are clean.

## Deliberately not bridged: `terminal`

ACP's `terminal/*` capability would route the remote agent's process execution
through the Host's terminal service. It is left unadvertised on purpose:

- it is a five-method surface (`create`, `output`, `wait_for_exit`, `kill`,
  `release`) with its own ownership and lifetime rules, not a fifth line of the
  existing handler;
- the value it adds is a Host-rendered terminal, whereas the value the `fs`
  bridge adds is **enforcement** — the sandbox fence above is a security
  boundary, and the terminal bridge is presentation;
- an agent that self-serves its own shell already works (verified with Cursor in
  P1/P3), so not advertising it costs nothing functional.

If it is ever added, the same rule applies: advertise only what is implemented,
and carry the Session's policy into every call.

## Behaviour change worth knowing

With `fs: 'bridge'`, an agent that chooses to use the client filesystem gets the
Host's view of the workspace — including its sandbox — instead of writing around
it. That is the intent, but it means a Session that previously succeeded under
`read-only` because the agent ignored the sandbox now fails its writes. Set
`fs: 'isolate'` to get the old behaviour back.
