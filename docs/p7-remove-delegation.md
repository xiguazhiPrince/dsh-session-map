# P7 record — removing the subagent delegation route

**Date:** 2026-10-12 · **Status:** complete
**Builds on:** [P0](p0-spike.md) · [P1](p1-acp-route.md) · [P2](p2-preset-cards.md) · [P3](p3-lifecycle.md) · [P4](p4-approval-bridge.md) · [P5](p5-client-tool-views.md) · [P6](p6-fs-bridge.md)

## What was removed

The **delegation** half of the ACP work: a subagent provider per configured
agent, the tool rows mounted at runtime to reach them, the settings card that
edited the agent list, and everything that existed only to serve those —
`src/acp/` (2,066 lines across seven modules), `src/client/acp-card.ts`,
`src/client/acp-model.ts`, the ~260-line `.dsh-acp-*` stylesheet block, the
`subagent-acp` profile row, the `./acp` export, and two build entries.

The **conversational route** (`acp-agent`) is untouched: same schema fields, same
behaviour, same verification.

## Why the removal was mostly a wiring change

`src/acp-core/` already existed and was, at the time of removal, **referenced by
nothing** — 804 lines of dead code. It is an unfinished extraction: the shared,
vendor-shaped half of an ACP client, separated from the route that uses it. Its
`config.ts` had even been adapted already (`CONFIG_PREFIX` read
`dsh-session-map/acp-agent`).

That made the migration measurable rather than a rewrite:

| Module | Delegation copy | Core copy | Difference |
|---|---|---|---|
| `resolve.ts` | 354 lines | 354 lines | **0 lines** — byte-identical |
| `client.ts` | (extracted from `run.ts`) | 120 lines | `decidePermission` identical to `run.ts:255` |
| `config.ts` | 339 lines | 326 lines | core is the adapted form; adds the route's fields elsewhere |
| `contract.ts` | 205 lines | 64 lines | core keeps only the subprocess seam; the subagent seam died with the route |

So the change was: repoint six import sites, export `agentSchema`, and delete.
Call-site signatures were checked before deleting (`resolveAcpCommand` at
`channel.ts:308` against `resolve.ts:324`; `resolveChildCwd` at `adapter.ts:463`
against `resolve.ts:141`).

## What the typecheck caught

`src/acp-core/config.ts`'s `ResolvedAgent` named the configured name `name`,
while every consumer in `acp-agent` read `providerName`. Typecheck failed with
eleven `TS2339`s. Per the plan, the core was backfilled rather than the call
sites rewritten: one field, its resolver assignment, and the duplicate-name
check. Its doc comment now states what the field is — the model id on the `acp`
route and the stem of the agent's preset card.

The `enabled` field was left in the schema on purpose. It is live for this route
too (`resolveOptions` drops a disabled agent), so removing it would have changed
accepted config in a change that is supposed to be a removal.

## The test suite is the part that nearly left with it

All three test files belonged to the removed route — `acp.test.mjs` (21 cases,
the delegation driver end to end), `command.test.mjs` (15, command resolution and
config validation through the provider), `acp-card.test.mjs` (11, the card's pure
model) — plus `test/support/harness.mjs`, which only they used. Deleting the
feature would have left the package with **zero tests**.

Instead, the parts of `command.test.mjs` that test code which is still alive were
ported to **`test/core.test.mjs`**: command resolution (the Windows launcher
table, npm shim targets, `.cmd` interpreter fallback, PATH scanning, the
not-found diagnostic), working-directory resolution, and `resolveOptions` /
`agentSchema` validation. They now call the pure functions directly instead of
standing up a Host composition — which is both simpler and a better fit, since
none of that behaviour ever belonged to the route.

`test/mock-acp-agent.mjs` stays: it is no longer used by `pnpm test`, but the
`.dsh-dev/profiles/{approval,fsbridge}` probes use it to verify the approval and
filesystem paths deterministically.

**Result: 47 cases → 15 (14 pass, 1 POSIX-only skip).** Everything removed was
route-specific; everything kept is route-neutral.

## Consequence worth stating

**ACP agent configuration is now YAML-only.** The settings card was the only GUI
for it, and it configured the row that no longer exists. Anyone enabling
`acp-agent` edits `cordis.patch.yml` directly.

If a card is wanted back, the shape is clear: point it at the `acp-agent`
namespace and drop the delegation-only fields (`toolName`, and the `enabled`
checkbox whose meaning was "mount a provider and a tool row"). That is a separate
task and was an explicit non-goal here.

## Migration for an existing profile

A profile that had enabled `subagent-acp` keeps that row, and after upgrading the
package its `name: dsh-session-map/acp` no longer resolves — the Loader reports
"entry did not activate" for it and the row's `agents` list stops having any
effect. Delete the row from the profile's `cordis.patch.yml`.

Sessions created with a preset that no longer exists (e.g. your own `acp-mock`
from a probe profile) also fail to be re-created: the Host reads the recorded
`agentPreset` off the session's log and refuses an id it cannot resolve. Delete
those sessions, or re-add the agent that produced them. This is **not** a browser
cache problem — the id comes from disk, so refreshing changes nothing.

## Verified after the change

- `pnpm typecheck` clean; `pnpm build` produces five artifacts and no `lib/acp.js`
  or `lib/acp-model.js`;
- `pnpm test` 15 pass / 1 skip;
- `dsh --profile fsbridge --dump-config` shows exactly `session-map` and
  `acp-agent`;
- a real headless ACP Session still creates its file, answers, and records its
  mirrored tool call — the migration did not touch the route;
- the browser still renders the mirrored tool row and no longer has an ACP
  settings page.
