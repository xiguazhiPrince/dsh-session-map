# P8 record — the ACP vendors settings page

**Date:** 2026-10-12 · **Status:** complete
**Builds on:** [P0](p0-spike.md) · [P1](p1-acp-route.md) · [P2](p2-preset-cards.md) · [P3](p3-lifecycle.md) · [P4](p4-approval-bridge.md) · [P5](p5-client-tool-views.md) · [P6](p6-fs-bridge.md) · [P7](p7-remove-delegation.md)

## What came back

P7 deleted the settings card along with the delegation route it configured, and
wrote down the shape of its return: *"point it at the `acp-agent` namespace and
drop the delegation-only fields"*. This is that, plus the vendor presets the card
never had.

| Piece | State |
|---|---|
| `src/client/acp-model.ts` | restored from `53c2543^`, adapted: `toolName` dropped, `ACP_VENDORS` / `vendorAgent` / `uniqueName` added, absolute-`cwd` rule added |
| `src/client/acp-card.ts` | restored from `53c2543^`, adapted: vendor buttons, doc links, safety line, loading state, `dsm-acp-page*` classes, `acp-agent` as the fallback entry id |
| `test/acp-card.test.mjs` | restored, adapted, and extended with the vendor table and the real-schema namespace check |
| `tsdown.config.ts` | `acp-model` node entry back (the model is Node-testable as well as browser-bundled) |
| `src/client/css.ts` | the `dsh-acp-*` block re-authored as `dsm-acp-page*`, so it cannot collide with the `dsm-acp-tool*` block and follows this plugin's own prefix |
| `cordis.patch.yml` | the `acp-agent` row is **no longer `disabled: true`** (see below) |

## Why the row had to come on by default

The settings service only serves entries whose fiber is ACTIVE
(`packages/settings/settings/src/index.ts`, `describe()`), and it addresses them
by the Loader's tree-local entry id — the `acp-agent` row id itself, the same
convention as `bash-sandbox` (`ui-settings-shell`). A disabled row therefore has
no settings namespace at all, and a page that could only write into an enabled
row would be dead on every fresh install.

An **empty `agents` list registers nothing** — `src/acp-agent/index.ts` returns
before touching `ctx.llm`, `ctx.tools` or `ctx.agentPresets` — so the default
this changes is *not* "an agent may run": the switch that matters is whether the
list has an entry. Two consequences were handled with it:

- the empty-list line was downgraded from `logger.warn` to `logger.debug`
  (`HostContext.logger` grew the method it already had at runtime), because a
  fresh install now logs it on every start;
- the page registers **unconditionally** rather than through
  `configForms.whileServed`, so a profile that disables the row still gets the
  page with an explanation instead of silence.

The alternative — having the page call `remote.pluginManager.setPluginEnabled` —
was rejected: it adds a second remote dependency and a patch-reload failure mode
to a page whose whole job is editing one array.

## What the page writes, and what it deliberately does not

One field: `agents`. `Config.agents` is the row's only `.volatile()` field, and
`isVolatilePath` refuses every other path, so `approval`, `fs`, `idleDisposeMs`,
`utilityProvider`/`utilityModel` and the two graces stay profile-patch-only. The
page says so in one line instead of pretending otherwise.

The write is always the **whole array** in one `set`, because the settings
service strips the volatile field out of the stored patch and merges the new
value in wholesale (`strip(raw, form)` → `mergeLayers`): a single-array write is
atomic, index-free, and cannot leave half an agent list behind. Defaults are
dropped on the way out (`args: ['acp']`, `permission: allow`, `enabled: true`,
empty optional strings), so the patch stays readable:

```yaml
- id: acp-agent
  name: dsh-session-map/acp-agent
  config:
    agents:
      - name: cursor
        command: cursor-agent
```

The entry is found by **schema shape**, not by row id (`isAcpNamespace`: an
`agents` array whose items declare `name` and `command`), with `acp-agent` as the
fallback — so a profile that renamed or re-inserted the row still gets its page.

## The vendor table

Three entries in `ACP_VENDORS`, each with its documentation link:

| id | command | args | source |
|---|---|---|---|
| `cursor` | `cursor-agent` | `acp` | <https://cursor.com/docs/cli/acp> — newer installs may only provide `agent`; the resolver recognizes both |
| `opencode` | `opencode` | `acp` | <https://opencode.ai/docs/acp> |
| `gemini` | `gemini` | `--acp` | <https://geminicli.com/docs/cli/acp-mode/> — noted as superseded by Antigravity CLI on 2026-06-18 |

A preset fills command and args and picks a name that cannot collide with the
drafts already on the page (`cursor`, `cursor-2`, …). "自定义" is the same thing
with an empty draft.

## Verified

- `pnpm build` → `lib/index.js`, `lib/acp-agent.js`, `lib/acp-preset.js`,
  **`lib/acp-model.js`**, `lib/client.js`; `lib/client.js` still loads React
  through `require("react")` and keeps the `__ModuleLoader__` handoff.
- `pnpm typecheck` clean.
- `pnpm test` → **27 tests, 26 pass, 1 skip** (the POSIX-only case). The new
  `test/acp-card.test.mjs` drives `lib/acp-model.js`: draft round-trip, default
  dropping, the validation rules, `KEY=VALUE` and argv parsing, list edits, the
  vendor presets (`gemini` → `['--acp']` reaching the patch, `cursor` → dropped
  default), name de-duplication, and namespace recognition against the **real**
  `Config.toJSON()` from `lib/acp-agent.js`.
- `dsh --profile webdev --dump-config` in an isolated `DSH_HOME` shows the row
  without `disabled` and the page's write as a profile override.
- **Browser run** (headless Chromium over CDP against the `webdev` probe profile,
  which links this working tree):

  1. Settings nav now ends with `通用设置 / 模型 / 内置插件 / Agent 预设 / ACP`,
     and the page renders its heading 「ACP 供应商」, the vendor buttons
     (`+ Cursor CLI`, `+ opencode`, `+ Gemini CLI`, `+ 自定义`), the three doc
     links, and the empty-state line.
  2. Clicking `+ Cursor CLI` produced a card with 名称 `cursor`, 命令
     `cursor-agent`, 参数 `acp`, 权限 `allow —— 自动批准 agent 的权限请求`, and
     启用这个 agent checked; 保存 became enabled.
  3. Clicking 保存 wrote the YAML above into
     `.dsh-dev/profiles/webdev/cordis.patch.yml` and returned the page to its
     clean state (保存/放弃修改 disabled again).
  4. After a reload the card was still there — the values now come from the Host
     document through the `settings.describe` mirror — **and the new-session
     picker showed `ACP · cursor`**: the row re-synced from the volatile update
     and registered the model and its preset card live, with no restart. That is
     the P2 mechanism working through a P8 write.
  5. With the row explicitly `disabled: true` in the probe profile's patch, the
     page still appeared and rendered the guidance paragraph
     (「当前 Host 没有加载 ACP 组件…」) with no preset buttons and no list.

## Not verified in this pass

- No remote agent was actually launched from the page: the probe profile has no
  logged-in `cursor-agent`/`opencode`, and this change touches no part of the
  handshake. The route itself is P0–P6 evidence.
- The model picker's `acp` provider entry was not opened (the probe profile has
  no configured model catalog); the preset card in the new-session picker is the
  observable that the registration happened.

## Follow-ups left out on purpose

- Making `approval` / `fs` / `idleDisposeMs` / the utility route editable means
  marking them `.volatile()` and unwrapping `VolatileRef` for scalars too
  (`resolveOptions` / `resolveRouteOptions` read them directly today; a volatile
  scalar arrives wrapped, and reading it raw would silently fall back to the
  default). Separate change, separate risk.
- `idleDisposeMs: 0` is documented — and implemented in `channel.ts` — as "no
  reaper", but `src/acp-agent/config.ts` rejects non-positive values and applies
  the default, so `0` is unreachable. Untouched here; it belongs with the
  row-level fields above.
