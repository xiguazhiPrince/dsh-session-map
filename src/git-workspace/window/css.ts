/**
 * Stylesheet for the Git tool window.
 *
 * Every colour is a Harness theme token; the only plugin-local variables are the
 * Git semantic colours (file status and graph lanes), which the product tokens
 * do not cover. The sheet travels as a string because the static browser half
 * has no `styles` service.
 *
 * @module dsh-session-map/git-workspace/window/css
 */
export const CSS = `
.dgw {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  --dgw-modified: #4d9fec;
  --dgw-added: #73c991;
  --dgw-deleted: #9aa0a6;
  --dgw-conflict: #f14c4c;
  --dgw-untracked: #cbcb41;
  --dgw-addBg: rgba(115, 201, 145, .14);
  --dgw-delBg: rgba(241, 76, 76, .14);
}
.dgw * { box-sizing: border-box; }
.dgw-panelIcon { display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary); }
.dgw-panelIcon--active { color: var(--dsw-alias-brand-primary); }
.dgw-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.dgw-brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dgw-brand > svg { color: var(--dsw-alias-brand-primary); }
.dgw-select {
  height: 26px;
  max-width: 280px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.dgw-spacer { flex: 1 1 auto; }
.dgw-iconBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dgw-iconBtn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dgw-iconBtn:disabled { opacity: .45; cursor: default; }
.dgw-status { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dgw-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.dgw-tab {
  appearance: none;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 0 12px;
  font-size: 13px;
  cursor: pointer;
}
.dgw-tab:hover { color: var(--dsw-alias-label-primary); }
.dgw-tab--active { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.dgw-body { flex: 1 1 auto; min-height: 0; display: flex; }
.dgw-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 10px 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.dgw-errorText { flex: 1 1 auto; white-space: pre-wrap; word-break: break-word; }
.dgw-errorDetail {
  margin: 6px 0 0;
  max-height: 120px;
  overflow: auto;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
}
.dgw-retry { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); border-radius: 4px; font-size: 11px; padding: 2px 8px; cursor: pointer; }
.dgw-logLayout { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.dgw-tree {
  display: flex;
  flex-direction: column;
  width: 260px;
  flex: 0 0 260px;
  min-width: 200px;
  border-right: 1px solid var(--dsw-alias-border-l1);
  min-height: 0;
}
.dgw-treeHead { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dgw-search { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; color: var(--dsw-alias-label-secondary); }
.dgw-searchInput {
  width: 100%;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.dgw-treeScroll { flex: 1 1 auto; overflow: auto; padding: 4px 0 10px; }
.dgw-treeSectionHead {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 3px 8px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  text-transform: none;
  cursor: pointer;
}
.dgw-treeSectionHead:hover { color: var(--dsw-alias-label-primary); }
.dgw-treeSectionHead > svg { transition: transform .12s ease; }
.dgw-treeSectionHead[data-open='false'] > svg { transform: rotate(-90deg); }
.dgw-treeRow {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px 0 14px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.dgw-treeRow:hover { background: var(--dsw-alias-bg-layer-2); }
.dgw-treeRow--folder { width: 100%; border: 0; background: transparent; text-align: left; font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); }
.dgw-treeRow--folder > svg:first-child { transition: transform .12s ease; }
.dgw-treeRow--folder[data-open='false'] > svg:first-child { transform: rotate(-90deg); }
.dgw-treeRow--active,
.dgw-treeRow--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.dgw-treeRow > svg { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dgw-treeRow--current > svg { color: var(--dsw-alias-brand-primary); }
.dgw-treeName { overflow: hidden; text-overflow: ellipsis; }
.dgw-treeRow--current .dgw-treeName { font-weight: 600; }
.dgw-treeBadge { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dgw-list { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; border-right: 1px solid var(--dsw-alias-border-l1); }
.dgw-listHead { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); min-height: 37px; }
.dgw-chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 11px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); color: var(--dsw-alias-brand-primary); font-size: 11px; white-space: nowrap; }
.dgw-rows { flex: 1 1 auto; overflow: auto; min-height: 0; }
.dgw-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px 0 0;
  background: transparent;
  cursor: default;
  white-space: nowrap;
  border-bottom: 1px solid transparent;
}
.dgw-row:hover { background: var(--dsw-alias-bg-layer-1); }
.dgw-row--active,
.dgw-row--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
.dgw-rowMenu { flex: 0 0 auto; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 1; cursor: pointer; opacity: 0; }
.dgw-row:hover .dgw-rowMenu { opacity: 1; }
.dgw-rowMenu:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dgw-gutter { flex: 0 0 auto; height: 26px; }
.dgw-subject { overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; }
.dgw-pills { display: inline-flex; gap: 4px; flex: 0 1 auto; overflow: hidden; }
.dgw-pill { display: inline-block; max-width: 160px; overflow: hidden; text-overflow: ellipsis; padding: 0 6px; border-radius: 8px; font-size: 10px; line-height: 16px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dgw-pill--tag { color: var(--dsw-alias-state-warn-primary); }
.dgw-meta { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dgw-loadMore { width: 100%; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 6px; cursor: pointer; }
.dgw-loadMore:hover { color: var(--dsw-alias-label-primary); }
.dgw-detail { display: flex; flex-direction: column; flex: 0 0 380px; width: 380px; min-width: 300px; min-height: 0; }
.dgw-detailHead { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); min-height: 37px; }
.dgw-hash { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; color: var(--dsw-alias-label-primary); }
.dgw-detailScroll { flex: 0 0 auto; max-height: 45%; overflow: auto; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dgw-msg { white-space: pre-wrap; word-break: break-word; margin-bottom: 8px; }
.dgw-detailMeta { font-size: 11px; color: var(--dsw-alias-label-secondary); display: flex; flex-direction: column; gap: 3px; }
.dgw-detailRefs { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.dgw-sectionTitle { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 8px 0 4px; }
.dgw-fileRow { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 4px; border-radius: 3px; cursor: pointer; white-space: nowrap; }
.dgw-fileRow:hover { background: var(--dsw-alias-bg-layer-2); }
.dgw-fileRow--active,
.dgw-fileRow--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.dgw-fileRow > svg { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dgw-filePath { overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; }
.dgw-fileStat { flex: 0 0 auto; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dgw-fileStat--add { color: var(--dgw-added); }
.dgw-fileStat--del { color: var(--dgw-conflict); }
.dgw-diff { flex: 1 1 auto; min-height: 0; overflow: auto; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; line-height: 17px; }
.dgw-diffLine { display: flex; white-space: pre; padding-right: 8px; }
.dgw-diffLine--add { background: var(--dgw-addBg); }
.dgw-diffLine--del { background: var(--dgw-delBg); }
.dgw-diffLineNo { flex: 0 0 42px; color: var(--dsw-alias-label-secondary); text-align: right; padding-right: 8px; user-select: none; }
.dgw-diffSign { flex: 0 0 14px; color: var(--dsw-alias-label-secondary); }
.dgw-hunkHead { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); padding: 2px 8px; }
.dgw-empty { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; padding: 24px; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }
.dgw-emptyBox { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: 320px; }
.dgw-loading { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dgw-console { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dgw-consoleRow { display: flex; gap: 8px; padding: 5px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; }
.dgw-consoleExit { flex: 0 0 auto; color: var(--dsw-alias-state-success-primary); }
.dgw-consoleExit--fail { color: var(--dsw-alias-state-error-primary); }
.dgw-consoleArgv { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgw-consoleMs { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dgw-statusBar { display: flex; align-items: center; gap: 12px; height: 24px; padding: 0 10px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; flex: 0 0 auto; }
.dgw-statusBar--warn { color: var(--dsw-alias-state-warn-primary); }
.dgw-commit { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dgw-changeScroll { flex: 1 1 auto; overflow: auto; min-height: 0; padding: 4px 0; }
.dgw-changeSection { padding: 2px 0; }
.dgw-changeHead { display: flex; align-items: center; gap: 6px; padding: 3px 10px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 600; }
.dgw-changeRow { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px 0 14px; cursor: pointer; }
.dgw-changeRow:hover { background: var(--dsw-alias-bg-layer-2); }
/* The right-column page previews on row click: the matching row stays marked. */
.dgw-changeRow--active,
.dgw-changeRow--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.dgw-changeRow--nested { padding-left: 26px; }
.dgw-changeHead--button { width: 100%; border: 0; background: transparent; text-align: left; cursor: pointer; }
.dgw-checkbox { flex: 0 0 14px; width: 14px; height: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; background: var(--dsw-alias-bg-layer-1); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; line-height: 1; color: var(--dsw-alias-bg-base); }
.dgw-checkbox--button { padding: 0; font: inherit; cursor: pointer; }
.dgw-checkbox[data-checked='true'] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
/* Directory rows of the grouped change tree (right-column page). */
.dgw-changeDir { display: flex; align-items: center; gap: 5px; width: 100%; height: 24px; padding: 0 10px 0 14px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; text-align: left; cursor: pointer; white-space: nowrap; }
.dgw-changeDir:hover { background: var(--dsw-alias-bg-layer-2); }
.dgw-changeDirName { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.dgw-changeDirCount { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dgw-changeChevron { display: inline-flex; transition: transform .12s ease; }
.dgw-changeChevron[data-open='false'] { transform: rotate(-90deg); }
.dgw-changePath { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; }
.dgw-changeStatus { flex: 0 0 auto; font-size: 10px; font-weight: 700; }
.dgw-discard { flex: 0 0 auto; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10px; cursor: pointer; opacity: 0; }
.dgw-changeRow:hover .dgw-discard { opacity: 1; }
.dgw-discard:hover { color: var(--dsw-alias-state-error-primary); }
.dgw-commitForm { flex: 0 0 auto; border-top: 1px solid var(--dsw-alias-border-l1); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.dgw-textarea { min-height: 64px; max-height: 180px; resize: vertical; padding: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
.dgw-formRow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dgw-label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dgw-btn { height: 26px; padding: 0 10px; flex: 0 0 auto; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }
.dgw-btn:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dgw-btn:disabled { opacity: .5; cursor: default; }
.dgw-btn--primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dgw-btn--danger { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-bg-base); }
.dgw-inlineError { color: var(--dsw-alias-state-error-primary); font-size: 11px; white-space: pre-wrap; }
.dgw-modalBackdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 10; }
.dgw-modal { width: 360px; max-width: calc(100% - 32px); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-overlay); padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.dgw-modalTitle { font-weight: 600; }
.dgw-modalText { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }
.dgw-modalActions { display: flex; justify-content: flex-end; gap: 8px; }
.dgw-menu { position: fixed; z-index: 20; min-width: 170px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 8px 24px rgba(0,0,0,.35); display: flex; flex-direction: column; }
.dgw-menuItem { border: 0; background: transparent; text-align: left; padding: 5px 10px; border-radius: 4px; color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }
.dgw-menuItem:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }
.dgw-fieldLabel { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dgw-input { height: 26px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; }
/* Side-by-side diff (right-column page). One row is two aligned halves; a
   missing line on either side keeps the row height with a muted filler. */
.dgw-diffSide { display: flex; flex-direction: column; }
.dgw-diffSideRow { display: flex; align-items: stretch; }
/* Each side scrolls horizontally on its own. The scrollbar chrome stays hidden
   so one long line does not make that row taller than its pair; trackpad /
   Shift+wheel still scrolls the hovered side independently. */
.dgw-diffSideCell {
  display: flex;
  flex: 1 1 50%;
  min-width: 0;
  white-space: pre;
  padding-right: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.dgw-diffSideCell::-webkit-scrollbar { height: 0; }
.dgw-diffSideCell > span:last-child { flex: 0 0 auto; }
.dgw-diffSideCell--add { background: var(--dgw-addBg); }
.dgw-diffSideCell--del { background: var(--dgw-delBg); }
.dgw-diffSideCell--empty { background: var(--dsw-alias-bg-layer-1); opacity: .35; }
.dgw-diffSideRow > .dgw-diffSideCell:first-child { border-right: 1px solid var(--dsw-alias-border-l1); }
`
