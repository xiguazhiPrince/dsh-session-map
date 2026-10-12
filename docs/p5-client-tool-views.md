# P5 record — the client-side tool views (step A)

**Date:** 2026-10-12 · **Status:** verified in the browser
**Builds on:** [P0](p0-spike.md) · [P1](p1-acp-route.md) · [P2](p2-preset-cards.md) · [P3](p3-lifecycle.md) · [P4](p4-approval-bridge.md)

## What step A delivers

The mirrored ACP calls now render as **`读取 · ignored`**-style rows instead of
`工具调用 · acp_read · session-…::mock#1`: a status dot, the category in words,
the remote agent's own title for the call, the file it touched, and an expander
holding the raw input and the remote output.

| File | Role |
|---|---|
| [`src/client/acp-tool-row.ts`](../src/client/acp-tool-row.ts) | The row, plus the ten wire names it claims |
| [`src/client/index.ts`](../src/client/index.ts) | Registers one view per key through `slots.inject` |
| [`src/client/css.ts`](../src/client/css.ts) | `.dsm-acp-tool*`, riding the product's theme tokens |

## Why a host-side presenter was not enough

P4 added `presentCall` to the mirror tools, and the row still showed the internal
call id. The reason is client-side, and the code is explicit about it:

```
titleKey = toolTitleKey(toolName)                        // fixed locale-key table
summary  = [titleKey === 'tool.title.generic' ? toolName : '', base].join(' · ')
```

`toolRowModel` builds the row from the **wire tool name** and the raw arguments;
`ToolCallTree`'s fallback is `<GenericToolCard {...owner} />` where `owner` is the
client's own call block. No host presentation is in that path. An unknown wire
name therefore falls to `tool.title.generic`, and the row reads
`<toolName> · <derived summary>`.

The supported way for a package to own that row is the keyed
`tool.call.toolview` slot, whose contract says plainly: *"Any name is allowed,
including tools registered by your package."* So the fix belongs in this plugin's
browser half, drawn with `createElement` and this plugin's own classes because
the product's row primitives are not importable from a standalone package.

The host-side `presentCall` stays: it is a legitimate host render intent for the
CLI/TUI rendering path. It simply is not this card.

## Verified

Driven with REA's Playwright provider against the probe instance (headless
Chromium, real app, real ACP agent), after approving the permission prompt:

```
- status: Completed
- text: Completed in 1s
- button "Think thinking"
- paragraph: pong
- button "读取 ignored +"        ← this row
```

Before step A the same call read
`工具调用 · acp_read · session-…::mock#1`. The screenshot
(`.dsh-dev/verify-A.png`) shows the row inline with the transcript, styled with
the product's tokens; `pnpm typecheck`, `pnpm build` and `pnpm test` (46 pass /
1 skipped) are clean.

## Scope and limits

- Ten wire names are claimed, one per ACP tool kind. A tool name the route does
  not register still gets the shell's generic row, which is the correct fallback
  for a call this plugin did not mirror.
- Category labels are hard-coded Chinese, like every other string this plugin
  ships; the locale service would add a namespace and two dictionaries for ten
  short words.
- The row renders the **arguments as emitted**, so a remote field that only
  arrives in a later `tool_call_update` (Cursor's `rawInput`, for instance) shows
  in the output, not the input. That is the P1 snapshot limitation, unchanged.
