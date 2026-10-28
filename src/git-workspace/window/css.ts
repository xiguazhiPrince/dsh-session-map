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
/* Compact text actions above a tree (expand/collapse all). */
.dgw-treeActions { display: flex; justify-content: flex-end; gap: 6px; padding: 2px 8px; flex: 0 0 auto; }
.dgw-changeActions { display: flex; justify-content: flex-end; gap: 6px; padding: 4px 10px 0; flex: 0 0 auto; }
.dgw-linkBtn { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; padding: 1px 4px; border-radius: 3px; cursor: pointer; }
.dgw-linkBtn:hover { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }

.dgw-treeSectionHead {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 5px 8px 5px 10px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .02em;
  text-transform: none;
  cursor: pointer;
}
/* Groups read as blocks instead of one flat run of rows. */
.dgw-treeRow + .dgw-treeSectionHead,
.dgw-treeSectionHead + .dgw-treeSectionHead {
  margin-top: 4px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dgw-treeSectionHead:hover { color: var(--dsw-alias-label-primary); }
.dgw-treeSectionHead > svg { transition: transform .12s ease; }
.dgw-treeSectionHead[data-open='true'] > svg { transform: rotate(90deg); }
.dgw-treeRow {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px 0 20px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.dgw-treeRow:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.dgw-treeRow--folder { width: 100%; border: 0; background: transparent; text-align: left; font: inherit; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dgw-treeRow--folder > svg:first-child { transition: transform .12s ease; }
.dgw-treeRow--folder[data-open='true'] > svg:first-child { transform: rotate(90deg); }
/* Current branch gets a light brand wash; the branch-filter selection is
   stronger and keeps its tint even while hovered. */
.dgw-treeRow--current { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent); }
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
.dgw-row:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }
.dgw-row--active,
.dgw-row--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
/* IDEA mutes merge commits: their subject uses the secondary text tone so a
   "Merge branch ..." entry does not compete with ordinary commits. */
.dgw-row--merge .dgw-subject { color: var(--dsw-alias-label-secondary); }
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
/* The log tab's outer columns own the adjustable width; the panes fill them. */
.dgw-treeCol { display: flex; flex-direction: column; flex: 0 0 auto; min-height: 0; min-width: 0; }
.dgw-treeCol > .dgw-tree { width: 100%; flex: 1 1 auto; min-width: 0; }
.dgw-detailCol { display: flex; flex-direction: column; flex: 0 0 auto; min-height: 0; min-width: 0; }
.dgw-detailCol > .dgw-detail { width: 100%; flex: 1 1 auto; min-width: 0; }
.dgw-splitter { flex: 0 0 5px; width: 5px; cursor: col-resize; background: transparent; }
.dgw-splitter:hover, .dgw-splitter:active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); }
.dgw-detailHead { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); min-height: 37px; }
.dgw-hash { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; color: var(--dsw-alias-label-primary); }
/* Without a selected file the commit info owns the whole detail pane; once a
   file is chosen the diff gets the lower part and this block is capped. */
.dgw-detailScroll { flex: 1 1 auto; min-height: 0; max-height: none; overflow: auto; padding: 9px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dgw-detailScroll--pinned { flex: 0 0 auto; max-height: 60%; }
.dgw-msg { white-space: pre-wrap; word-break: break-word; margin-bottom: 8px; font-size: 12px; line-height: 18px; }
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
.dgw-changeRow { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px 0 8px; cursor: pointer; }
.dgw-changeRow:hover { background: var(--dsw-alias-bg-layer-2); }
/* The right-column page previews on row click: the matching row stays marked. */
.dgw-changeRow--active,
.dgw-changeRow--active:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
/* One vertical guide per nesting level, so deep paths read as a tree. */
.dgw-changeGuide,
.dgw-treeGuide {
  flex: 0 0 12px;
  width: 12px;
  align-self: stretch;
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.dgw-changeHead--button { width: 100%; border: 0; background: transparent; text-align: left; cursor: pointer; }
.dgw-checkbox { flex: 0 0 14px; width: 14px; height: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; background: var(--dsw-alias-bg-layer-1); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; line-height: 1; color: var(--dsw-alias-bg-base); }
.dgw-checkbox--button { padding: 0; font: inherit; cursor: pointer; }
.dgw-checkbox[data-checked='true'] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
/* Directory rows of the grouped change tree (right-column page). */
.dgw-changeDir { display: flex; align-items: center; gap: 5px; width: 100%; height: 24px; padding: 0 10px 0 8px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; text-align: left; cursor: pointer; white-space: nowrap; }
.dgw-changeDir:hover { background: var(--dsw-alias-bg-layer-2); }
.dgw-changeDirName { flex: 0 1 auto; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.dgw-changeDirCount { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dgw-changeChevron { display: inline-flex; transition: transform .12s ease; }
.dgw-changeChevron[data-open='true'] { transform: rotate(90deg); }
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
/* Push preview: IDEA-style two panes, commits on the left, changed files on the right. */
.dgw-pushModal {
  width: min(900px, calc(100vw - 80px));
  height: min(620px, calc(100vh - 120px));
  max-width: none;
  padding: 0;
  gap: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
}
.dgw-pushTitle {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 13px;
  font-weight: 600;
}
.dgw-pushTitleText { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgw-pushClose { flex: 0 0 auto; }
.dgw-pushBody { display: flex; flex: 1 1 auto; min-height: 0; }
.dgw-pushLeft {
  flex: 0 0 280px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  /* Shift-click extends the row selection; without this the browser would also
     drag-select the commit text. */
  user-select: none;
}
/* The branch row stays pinned; only the commit list scrolls. */
.dgw-pushMapping { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
.dgw-pushBranchToggle { flex: 0 0 auto; display: inline-flex; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dgw-pushBranchToggle svg { transition: transform .12s ease; }
.dgw-pushBranchToggle[data-open='true'] svg { transform: rotate(90deg); }
.dgw-pushMappingText { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgw-pushCommits {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  margin-left: 18px;
  border-left: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
}
.dgw-pushMapping {
  flex: 0 0 auto;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
/* Three explicit states: transparent, a light hover wash, and a pale blue
   selection that keeps its tint while hovered. */
.dgw-pushMapping:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }
.dgw-pushMapping--active,
.dgw-pushMapping--active:hover { background: color-mix(in srgb, #4f9cf9 20%, transparent); color: var(--dsw-alias-label-primary); }
.dgw-pushMapping--active .dgw-meta { color: var(--dsw-alias-label-secondary); opacity: 1; }
.dgw-pushCommit {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px 8px 10px;
  border-bottom: 0;
  background: transparent;
  font-size: 12px;
  cursor: pointer;
}
.dgw-pushCommit:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }
.dgw-pushCommit--active,
.dgw-pushCommit--active:hover { background: color-mix(in srgb, #4f9cf9 20%, transparent); color: var(--dsw-alias-label-primary); }
.dgw-pushCommit--active .dgw-meta { color: var(--dsw-alias-label-secondary); opacity: 1; }
.dgw-pushRight { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); }
/* Two draggable edges: left/right widths, then file/message heights. */
.dgw-pushVSplit {
  flex: 0 0 6px;
  width: 6px;
  cursor: col-resize;
  background: var(--dsw-alias-bg-layer-1);
  border-left: 1px solid var(--dsw-alias-border-l1);
  border-right: 1px solid var(--dsw-alias-border-l1);
}
.dgw-pushHSplit {
  flex: 0 0 6px;
  height: 6px;
  cursor: row-resize;
  background: var(--dsw-alias-bg-layer-1);
  border-top: 1px solid var(--dsw-alias-border-l1);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dgw-pushVSplit:hover, .dgw-pushHSplit:hover { background: color-mix(in srgb, #4f9cf9 30%, transparent); }
.dgw-pushSectionHead {
  flex: 0 0 auto;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.dgw-pushFiles { flex: 1 1 auto; overflow: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 1px; }
/* Bottom half of the right pane: the selected commit's full message. */
.dgw-pushMessage {
  flex: 0 0 auto;
  max-height: none;
  overflow: auto;
  padding: 10px 14px;
  box-sizing: border-box;
  border-top: 0;
  background: var(--dsw-alias-bg-base);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dgw-pushMessage .dgw-pushSectionHead { flex: 0 0 auto; padding: 0 0 4px; border-bottom: 0; background: transparent; }
.dgw-pushMessageHead { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dgw-pushMessageBody { white-space: pre-wrap; word-break: break-word; font-size: 12px; color: var(--dsw-alias-label-primary); }
.dgw-pushMessageMeta { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dgw-pushFolder, .dgw-pushFile { display: flex; align-items: center; gap: 8px; font-size: 12px; height: 22px; padding-right: 4px; }
.dgw-pushFolder { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dgw-pushFolder > svg, .dgw-pushFile > svg { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dgw-pushFolderName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgw-pushFolder > .dgw-meta { margin-left: auto; }
.dgw-pushFile:hover { background: var(--dsw-alias-bg-layer-1); border-radius: 3px; }
.dgw-pushSubject, .dgw-pushFilePath { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgw-pushFilePath { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; }
.dgw-pushFileStatus { flex: 0 0 14px; color: var(--dsw-alias-label-secondary); }
.dgw-pushEmpty { padding: 12px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dgw-pushFooter {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--dsw-alias-bg-layer-1);
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dgw-choice { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dgw-choice input { accent-color: var(--dsw-alias-brand-primary); }
.dgw-modalActions { display: flex; justify-content: flex-end; gap: 8px; }
.dgw-menu { position: fixed; z-index: 20; min-width: 170px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 8px 24px rgba(0,0,0,.35); display: flex; flex-direction: column; }
.dgw-menuItem { border: 0; background: transparent; text-align: left; padding: 5px 10px; border-radius: 4px; color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }
.dgw-menuItem:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }
.dgw-fieldLabel { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dgw-input { height: 26px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; }
/* Side-by-side diff: two code panes that scroll horizontally (linked), and a
   fixed centre gutter with both line numbers. Vertical scrolling is mirrored
   across all three so rows stay aligned; the numbers never move sideways. */
.dgw-diffSide { display: flex; align-items: stretch; height: 100%; min-height: 0; overflow: hidden; }
.dgw-diffSidePane { flex: 1 1 50%; min-width: 0; min-height: 0; overflow-x: scroll; overflow-y: auto; overscroll-behavior: contain; }
/* Both panes keep their own (linked) vertical scrollbar, like IDEA's diff:
   dragging either one moves both, and wheel/trackpad still works. */
.dgw-diffSideGutter {
  flex: 0 0 84px;
  width: 84px;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--dsw-alias-border-l1);
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.dgw-diffGutterTrack { display: flex; flex-direction: column; width: 100%; will-change: transform; }
.dgw-diffSideRow {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  width: max-content;
  min-width: 100%;
  height: 17px;
  line-height: 17px;
  white-space: pre;
  padding: 0 8px;
}
.dgw-diffSideRow--add { background: var(--dgw-addBg); }
.dgw-diffSideRow--del { background: var(--dgw-delBg); }
.dgw-diffSideText { flex: 0 0 auto; }
.dgw-diffSideHunk {
  flex: 0 0 auto;
  width: max-content;
  min-width: 100%;
  height: 20px;
  line-height: 20px;
  padding: 0 8px;
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-1);
}
.dgw-diffSideHunk--blank { color: transparent; }
.dgw-diffGutterRow { display: flex; flex: 0 0 auto; height: 17px; }
.dgw-diffGutterNo {
  flex: 1 1 50%;
  min-width: 0;
  padding-right: 6px;
  text-align: right;
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
}
.dgw-diffGutterNo--add { background: var(--dgw-addBg); }
.dgw-diffGutterNo--del { background: var(--dgw-delBg); }
.dgw-diffGutterHunk { flex: 0 0 auto; height: 20px; background: var(--dsw-alias-bg-layer-1); }
`
