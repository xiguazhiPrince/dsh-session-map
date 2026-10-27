/**
 * Layout stylesheet of the Git right-column page.
 *
 * It is concatenated after the shared `CSS` string (which owns the `--dgw-*`
 * semantic colours and the `.dgw-*` component classes), so this file only adds
 * the page's own boxes. Every value rides a Harness theme token.
 *
 * @module dsh-session-map/git-workspace/window/rightbar/css
 */
export const RIGHTBAR_CSS = `
.dgw-rb { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dgw-rb__top {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  flex: 0 0 auto;
  padding: 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.dgw-rb__chip {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.dgw-rb__repo {
  min-width: 0;
  max-width: 180px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dgw-rb__main { display: flex; flex: 1 1 auto; min-height: 0; }
.dgw-rb__commitCol {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dgw-rb__commitCol > .dgw-commit { flex: 1 1 auto; min-height: 0; }
.dgw-rb__vsplit {
  flex: 0 0 6px;
  width: 6px;
  cursor: col-resize;
  border-left: 1px solid var(--dsw-alias-border-l1);
  border-right: 1px solid var(--dsw-alias-border-l1);
}
.dgw-rb__vsplit:hover { background: var(--dsw-alias-brand-primary); opacity: .35; }
.dgw-rb__diff { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }
.dgw-rb__diffHead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  flex: 0 0 auto;
  padding: 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.dgw-rb__diffTitle { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
.dgw-rb__diffDir {
  min-width: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dgw-rb__diffScroll { flex: 1 1 auto; min-height: 0; overflow: auto; background: var(--dsw-alias-bg-base); }
.dgw-rb__splitter {
  flex: 0 0 6px;
  height: 6px;
  cursor: row-resize;
  border-top: 1px solid var(--dsw-alias-border-l1);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dgw-rb__splitter:hover { background: var(--dsw-alias-brand-primary); opacity: .35; }
.dgw-rb__log { flex: 0 0 auto; display: flex; flex-direction: column; min-height: 120px; background: var(--dsw-alias-bg-base); }
.dgw-rb__logHead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  flex: 0 0 auto;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dgw-rb__logBody { position: relative; flex: 1 1 auto; display: flex; min-height: 0; }
.dgw-rb__details {
  flex: 0 0 250px;
  width: 250px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--dsw-alias-border-l1);
}
.dgw-rb__detailsHead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.dgw-rb__detailsScroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 10px; }
.dgw-rb__drawer {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
}
.dgw-rb__drawer .dgw-rb__details { flex: 1 1 auto; width: auto; border-left: none; }
.dgw-rb__drawerHead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  flex: 0 0 auto;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dgw-rb__status {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 22px;
  flex: 0 0 auto;
  padding: 0 10px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
}
.dgw-rb__status > span { overflow: hidden; text-overflow: ellipsis; }
.dgw-rb__empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  text-align: center;
}
.dgw-rb__emptyBox { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: 320px; }
.dgw-iconBtn--active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
`
