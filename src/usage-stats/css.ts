/**
 * Component-local stylesheet of the usage statistics page. Every color is a
 * Harness theme token or a `color-mix` of tokens, so light and dark themes
 * follow without a second palette. Layout uses auto-fit grids instead of
 * media queries because the Settings content width is not the viewport width.
 *
 * @module dsh-session-map/usage-stats/css
 */

/** Heat-map shade of one level, mixed over the card surface. */
const heat = (percent: number): string =>
  `color-mix(in srgb, var(--dsw-alias-state-success-primary) ${String(percent)}%, var(--dsw-alias-bg-layer-1))`

/** The page stylesheet, prefixed `us-`. */
export const USAGE_CSS = `
.us-page { box-sizing: border-box; padding: 2px 0 28px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: inherit; }
.us-page * { box-sizing: border-box; }
.us-dim { display: flex; flex-direction: column; gap: 14px; opacity: 0.55; transition: opacity 0.2s ease; }
.us-inner { display: flex; flex-direction: column; gap: 14px; max-width: 760px; }
.us-head { display: flex; flex-direction: column; gap: 4px; }
.us-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.us-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.us-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.us-toolbarEnd { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.us-meta { color: var(--dsw-alias-label-secondary); font-size: 11.5px; white-space: nowrap; }
.us-seg { display: inline-flex; flex: none; padding: 2px; border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); }
.us-seg--plain { background: none; padding: 0; gap: 2px; }
.us-segBtn { height: 26px; padding: 0 12px; border: 0; border-radius: 6px; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.us-seg--plain .us-segBtn { height: 24px; padding: 0 10px; font-size: 12px; }
.us-segBtn:hover { color: var(--dsw-alias-label-primary); }
.us-segBtn[aria-pressed=true], .us-segBtn[aria-selected=true] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 600; box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2), 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.us-seg--plain .us-segBtn[aria-pressed=true] { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); box-shadow: none; }
.us-segBtn:focus-visible, .us-btn:focus-visible, .us-select:focus-visible, .us-metric:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.us-select, .us-btn { flex: none; height: 30px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.us-btn:hover:not(:disabled), .us-select:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.us-btn:disabled { cursor: default; opacity: 0.5; }
.us-card { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); min-width: 0; }
.us-cardHead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; }
.us-cardTitle { margin: 0; font-size: 13px; font-weight: 600; }
.us-cardHint { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.us-heatHead { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 8px; }
.us-heatTotals { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.us-metric { align-self: flex-start; margin-left: -4px; padding: 0 2px; height: 22px; border: 0; border-radius: 6px; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; cursor: pointer; }
.us-metric:hover { color: var(--dsw-alias-label-primary); }
.us-bigRow { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; }
.us-big { font-size: 26px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }
.us-num { font-variant-numeric: tabular-nums; }
.us-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; font-variant-numeric: tabular-nums; }
.us-add { color: var(--dsw-alias-state-success-primary); }
.us-del { color: var(--dsw-alias-state-error-primary); }
.us-muted { color: var(--dsw-alias-label-secondary); }
.us-originSeg { margin-left: auto; }
/* A scroll container clips everything past its padding box, including the hover outline
   (1.5px + 0.5px offset): a 3px gutter, cancelled by an equal negative margin, gives the
   edge cells' outline room without moving the grid. */
.us-heatScroll { overflow-x: auto; overflow-y: hidden; padding: 3px; margin: -3px; }
.us-heatGrid { display: grid; grid-template-columns: 24px minmax(0, 1fr); row-gap: 4px; }
.us-months, .us-cells { display: grid; grid-template-columns: repeat(var(--us-weeks), minmax(0, 1fr)); column-gap: 2px; }
.us-months { grid-column: 2; grid-row: 1; height: 16px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
.us-month { min-width: 0; white-space: nowrap; overflow: visible; }
.us-corner, .us-weekdays { position: sticky; left: 0; z-index: 1; grid-column: 1; background: var(--dsw-alias-bg-layer-1); }
.us-corner { grid-row: 1; }
.us-weekdays { display: grid; grid-template-rows: repeat(7, 1fr); row-gap: 2px; padding-right: 6px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1; }
.us-weekdays span { display: flex; align-items: center; white-space: nowrap; }
.us-cells { grid-column: 2; grid-template-rows: repeat(7, auto); grid-auto-flow: column; row-gap: 2px; }
.us-cell { aspect-ratio: 1 / 1; border-radius: 2px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }
.us-cell--void { background: none; }
.us-cell--1 { background: ${heat(28)}; }
.us-cell--2 { background: ${heat(50)}; }
.us-cell--3 { background: ${heat(75)}; }
.us-cell--4 { background: var(--dsw-alias-state-success-primary); }
.us-cell--hover { position: relative; z-index: 2; outline: 1.5px solid var(--dsw-alias-label-primary); outline-offset: 0.5px; }
.us-tip { position: absolute; z-index: 3; padding: 6px 9px; border-radius: 7px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-size: 11.5px; line-height: 1.45; white-space: nowrap; pointer-events: none; transform: translate(-50%, calc(-100% - 8px)); box-shadow: 0 4px 14px color-mix(in srgb, var(--dsw-alias-label-primary) 25%, transparent); }
.us-tipValue { font-weight: 600; font-variant-numeric: tabular-nums; }
.us-tipSub { opacity: 0.75; font-variant-numeric: tabular-nums; }
.us-highlights { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px 16px; padding-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l1); }
.us-hl { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.us-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.us-hlValue { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.us-sub { color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.us-heatFoot { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 16px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.us-legend { display: inline-flex; align-items: center; gap: 3px; }
.us-legend .us-cell { width: 10px; }
.us-legend span:first-child { margin-right: 3px; }
.us-legend span:last-child { margin-left: 3px; }
.us-footNote { margin-left: auto; }
.us-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.us-kpi { display: flex; flex-direction: column; gap: 1px; padding: 11px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); min-width: 0; }
.us-kpiValue { font-size: 20px; font-weight: 600; line-height: 1.3; font-variant-numeric: tabular-nums; }
.us-hours { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); align-items: end; gap: 4px; height: 76px; }
.us-bar { min-height: 2px; border-radius: 3px 3px 0 0; background: ${heat(45)}; }
.us-bar--peak { background: var(--dsw-alias-state-success-primary); }
.us-hourAxis { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 4px; margin-top: -6px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; text-align: center; }
.us-tables { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; align-items: start; }
.us-wide { grid-column: 1 / -1; }
.us-tableCard { padding: 0; gap: 0; overflow: hidden; }
.us-tableCard .us-cardHead { padding: 12px 14px 10px; }
.us-tableScroll { overflow-x: auto; }
.us-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.us-table th { padding: 6px 10px; border-top: 0.5px solid var(--dsw-alias-border-l1); border-bottom: 0.5px solid var(--dsw-alias-border-l1); background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent); color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-weight: 400; text-align: left; white-space: nowrap; }
.us-table td { padding: 7px 10px; border-bottom: 0.5px solid var(--dsw-alias-border-l1); white-space: nowrap; }
.us-table tr:last-child td { border-bottom: 0; }
.us-table .us-r { text-align: right; font-variant-numeric: tabular-nums; }
.us-table th:first-child, .us-table td:first-child { padding-left: 14px; }
.us-table th:last-child, .us-table td:last-child { padding-right: 14px; }
.us-table td.us-name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.us-rest td { color: var(--dsw-alias-label-secondary); }
.us-notes { margin: 0; padding-left: 16px; color: var(--dsw-alias-label-secondary); font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.us-state { align-items: center; gap: 8px; padding: 36px 24px; text-align: center; }
.us-stateTitle { font-size: 13.5px; font-weight: 600; }
.us-stateText { max-width: 420px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.us-stateIcon { width: 22px; height: 22px; color: var(--dsw-alias-label-secondary); }
.us-stateIcon--error { color: var(--dsw-alias-state-error-primary); }
.us-spinner { width: 20px; height: 20px; border: 2px solid color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent); border-top-color: var(--dsw-alias-label-primary); border-radius: 50%; animation: us-spin 0.9s linear infinite; }
@keyframes us-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .us-spinner { animation-duration: 3s; } }
.us-progress { width: min(240px, 100%); height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); overflow: hidden; }
.us-progressFill { height: 100%; border-radius: 999px; background: var(--dsw-alias-state-success-primary); transition: width 0.3s ease; }
.us-banner { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
.us-banner--error { border-color: var(--dsw-alias-state-error-primary); }
.us-bannerTitle { font-weight: 500; color: var(--dsw-alias-state-warn-primary); }
.us-banner--error .us-bannerTitle { color: var(--dsw-alias-state-error-primary); }
.us-bannerPath { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.us-bannerActions { display: flex; gap: 8px; padding-top: 2px; }
`
