# P13 record — the empty state, said out loud

**Date:** 2026-10-15 · **Status:** shipped and verified in the browser
**Builds on:** [P2](p2-preset-cards.md) · [P8](p8-acp-settings-page.md) · [P11](p11-acp-mode-select.md)

## The report

> 在启动 ACP 组件之后，新会话是不显示 ACP 预设的，只有到设置中给 ACP 供应商添加一个 ACP server，才可以选择预设。启动了 ACP 组件了，但是预设菜单中没有 ACP 预设可以选择。

Every clause of that is the shipped behaviour working as designed, and that is
exactly the problem. Two facts that read as one on screen:

| What the person sees | What is true |
|---|---|
| The `acp-agent` row is enabled (the shipped default) | Nothing is registered: no adapter, no mirror tools, **no preset card** (`src/acp-agent/index.ts` returns early on an empty `agents`) |
| The mode menu has no ACP entry | The entry appears per configured agent, and the only page that adds one is Settings → ACP |

So "the component is on" and "ACP is available" are different states, only the
first is visible where the person is looking, and the second lives on a page
nothing points at. The menu said **nothing at all** — and silence has three
different causes, each fixed somewhere else:

| # | Cause | What was on screen |
|---|---|---|
| 1 | `agents` is empty | No ACP entry, every other preset fine, no explanation |
| 2 | 通用设置 → 代码工作工具 is off | The whole preset chip is absent — *every* mode, not just ACP — because `AgentPresetSeat` returns `null` |
| 3 | The row is disabled / the package is missing | The settings page degrades to its guidance paragraph (P8); there is no namespace to write |

A notice that only says "go configure ACP" would send cause 2's reader to the
wrong page. Naming the right blocker is the whole feature.

## What shipped

| Piece | State |
|---|---|
| `src/client/acp-model.ts` | `acpHintFor()` + `AcpHint`: the whole decision, pure and Node-testable — dismissed? blank Session? form ready? namespace empty? code tools on? |
| `src/client/acp-hint.ts` | The composer cell: reads the describe mirror → `selectAcpNamespace` → the row's form → `agents`, plus the code-tools preference and the Session's `blank` flag. Renders one dashed pill and a × |
| `src/client/snapshot.ts` | The `useSnapshot` bridge, extracted from `acp-card.ts` because two surfaces now need it |
| `src/client/acp-card.ts` | The page states the order of operations out loud, and the empty list now answers "what happens after I save?" |
| `src/client/index.ts` | Registers the cell in `conversation.input.right`, and reads the Sessions store for the blank gate |
| `src/client/css.ts` | `.dsm-acp-hint*`, borrowing the P11 mode control's metrics so it sits in that tool row |
| `test/acp-hint.test.mjs` | Eight cases, one per state the notice has to get right |

The two blockers read like this (labels carry the path, because a composer cell
cannot open Settings on a section — see below):

- cause 1 — `ACP 未配置 · 设置 → ACP`
- cause 2 — `预设选择已关闭 · 通用设置`

### Two gates that are not obvious

**Blank Sessions only.** The mode menu the notice is about exists on the
new-session screen; a Session that has already run was composed under its preset
and cannot change it. In a running conversation the same sentence would be a
non-sequitur repeated into every turn, so the cell reads the row's `blank` flag
and stays away otherwise. "Cannot tell" reads as blank, because the alternative
hides the only pointer at a state with no other way of announcing itself.

**Dismissible, and remembered.** A permanent warning in the composer for a
feature someone never intends to use is nagging, not help. The × writes
`dsh.session-map.acpHintDismissed` (browser-local, like
`CONVERSATION_VIEWS_KEY`) and the notice does not come back on that browser.

## Why not the obvious alternatives

- **A placeholder card in the preset menu.** This is the shape that would match
  the expectation best, and it is not available: `PresetDefinition` carries no
  disabled/status field, and the picker filters the roster down to healthy rows
  (`presetOptions` keeps only `broken === undefined`) — a *broken* card never
  reaches the menu. Registering a healthy card that pins nothing would put a
  selectable option in the menu that does nothing when selected, which is worse
  than silence. See the upstream path below.
- **Shadowing `conversation.hero.agentPreset`.** It is a `single` slot with
  `replaceRisk: shadows-shipped-ui`; taking it over means owning the product's
  own preset picker. The notice is not worth that.
- **Shipping the row `disabled: true`.** The order would then read
  enable → configure → the card appears, which is the mental model people
  arrive with — but P8 recorded why the row ships enabled (the settings service
  only serves ACTIVE entries, so a disabled row has no namespace), and enabling
  it from the page drags back the `pluginManager.setPluginEnabled` dependency
  P8 rejected. Not worth re-litigating for a discoverability fix.
- **Configuring an agent in place, from the notice.** One click instead of a
  trip to Settings — and one click to enable a remote process that can write in
  the Session's working directory and that DSH's sandbox does not cover. Left
  out deliberately.

## The channel the notice does not have

`openSection(id)` — "open the settings panel directly on one registered
section" — is handed to `settings.onboarding` registrants and to nobody else
(`ui-settings/src/client/contract/slots.ts`). A composer cell gets no such
face, so the notice **cannot take anyone there**: it names the path in its own
text and stays non-interactive. That is the one place this design is weaker
than it wants to be.

## Verified

- **Unit** — `test/acp-hint.test.mjs`, 8 cases against `lib/acp-model.js`: the
  unconfigured label carries `设置 → ACP`; a closed code-tools switch names
  General and pointedly *not* the ACP page; a configured agent silences both
  branches; an unreadable entry still counts as configured; `loading` /
  `unavailable` say nothing; a dismissal outranks every state; a non-blank
  Session says nothing; a value the row never wrote reads as an empty list.
- **Browser**, against the `webdev` probe profile (which links this working
  tree) with headless Chromium over CDP, in both fixture states:
  1. `agents: []` — the notice is present and visible in the composer tool row,
     reading `ACP 未配置 · 设置 → ACP` with its ×, between the access-mode
     controls and the model seat.
  2. `agents: [cursor]` — `wait_for [data-dsm-acp-hint] hidden` settles in 21 ms
     and the same row is clean.

  Both screenshots are probe artifacts, so they live in the gitignored
  `.dsh-dev/p13-evidence/` rather than here.
- `pnpm build` → the four node artifacts plus `lib/client.js`; `pnpm typecheck`
  clean; the full suite gains 8 passing cases and the same 10 failures the tree
  had before the change (all of them subprocess-driven, see the note below).

## Not verified in this pass

- **Cause 2 live.** The code-tools branch is covered by unit tests only; the
  probe never had `ui-settings.enabled: false` written into its settings
  document. The branch is a pure function of that one boolean, so the gap is
  the wiring, not the copy.
- **The dismissal surviving a reload.** The write and the immediate hide are
  exercised by the same code path the other gates use; only `localStorage`
  persistence is untested live.
- **A composition without the Sessions store.** `isBlank` then answers
  `undefined` and the notice shows on every blank-or-unknown Session — the
  designed fail-open, never observed against a real composition.

## Follow-ups, deliberately left

- **The roster is where this belongs.** If `PresetDefinition` gained an
  unavailable/declared-but-unselectable state and `presetOptions` stopped
  treating "not ready" the same as "broken", the ACP card could sit *in* the
  menu the person is actually reading, and this composer notice would become
  redundant. That is a DSH upstream change, recorded rather than attempted.
- **Detection instead of explanation.** Probing PATH for the vendor CLIs
  (`resolveAcpCommand` already knows those launcher tables) and offering a
  one-click add would shrink the settings trip. A settings page is not a
  Session, though, and the only client→Host channel is a registered command —
  so whether that is reachable at all is an open question, not a plan.

**Note on the suite in a sandbox.** `pnpm test` runs `node --test`, which
spawns one child per file; under a file sandbox that blocks piped stdio the
isolation children (and the mock-agent children) fail with `EPERM`. Running the
same files with `--test-isolation=none` is the equivalent observation, and the
failing set is identical before and after this change.
