/**
 * The `BTW` button's stylesheet.
 *
 * The product has no `styles` service outside the dynamic runtime, so the sheet
 * travels as a string the plugin body injects once per fiber — the same pattern
 * the Session views use. Colors are theme tokens only, so light and dark follow
 * the app.
 *
 * It is drawn as a **native text action**, not a pill: the composer tool row is
 * a set of quiet icon+text controls (permission, model, branch), so a filled
 * capsule reads as a foreign widget. The affordance comes from the one thing
 * the row otherwise reserves for nothing — the brand color on the label and the
 * speech-bubble glyph — plus a soft hover fill in the same shape native
 * controls use. The button only exists while a turn runs, so it also fades in
 * when it appears rather than popping.
 *
 * @module dsh-session-map/btw/css
 */

/** The one stylesheet the `btw` feature injects. */
export const BTW_CSS = `
.dsm-btw {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  height: 24px;
  padding: 0 7px;
  border: 0.5px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-brand-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: background 120ms ease, border-color 120ms ease;
  animation: dsm-btw-appear 160ms ease-out;
}
.dsm-btw__glyph { width: 13px; height: 13px; flex: 0 0 auto; display: block; }
.dsm-btw:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}
.dsm-btw:active:not(:disabled) { transform: translateY(0.5px); }
.dsm-btw:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsm-btw:disabled { opacity: 0.55; cursor: default; animation: none; }
.dsm-btw--error { color: var(--dsw-alias-state-error-primary); }
.dsm-btw--error:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 26%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
}

@keyframes dsm-btw-appear {
  from { opacity: 0; transform: translateY(1px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .dsm-btw { animation: none; transition: none; }
}

/* The Session row mark: the product's 16px leading cell before the row title.
   It paints in the brand color so a btw fork is identifiable in the sidebar at
   a glance, and it inherits the row's own idle state — a louder row state
   replaces the whole cell with its status dot. */
.dsm-btw-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--dsw-alias-brand-primary);
}
.dsm-btw-mark__glyph { width: 12px; height: 12px; display: block; }
`
