/**
 * Stylesheet for the right column's bulk-close menu rows.
 *
 * The rows render inside the kit's own menu surface but cannot borrow its CSS
 * module, so the two rules below restate the kit's row material — same padding,
 * type scale, radius, and hover ground, every colour a theme token — and the
 * rows read as part of that menu rather than as a plugin widget dropped into
 * it. Only the label width differs: these labels are longer than the kit's
 * "关闭", so the row keeps them on one line instead of wrapping inside the
 * menu's 96px minimum width.
 *
 * @module dsh-session-map/rightbar-tab-menu/css
 */

/** Every rule the tab-menu rows use, in one sheet. */
export const CSS = `
.dsm-tabmenu__item {
  padding: 4px 7px;
  color: var(--dsw-alias-label-primary);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: 1.4;
  text-align: left;
  white-space: nowrap;
  background: transparent;
  border: none;
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
}
.dsm-tabmenu__item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsm-tabmenu__item:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
`
