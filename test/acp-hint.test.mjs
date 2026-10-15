/**
 * The composer's ACP setup notice: which of the two blockers it names, and the
 * states it deliberately stays quiet in.
 *
 * The notice exists because two different problems — an empty agent list and a
 * closed code-tools switch — look identical from the composer. Every decision is
 * in `acpHintFor`, so this file needs no DOM and no React: it runs against the
 * built `lib/acp-model.js`, the same code the browser half bundles.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acpHintFor } from '../lib/acp-model.js'

/**
 * Ask for the notice in one state, with the fields a test does not care about
 * filled in as the shipped default (ready, code tools on, a blank Session,
 * nothing dismissed).
 * @param overrides - the fields this case is about.
 * @returns the notice, or undefined.
 */
function hint(overrides = {}) {
  return acpHintFor({
    status: 'ready',
    value: { agents: [] },
    developerTools: true,
    blank: true,
    dismissed: false,
    ...overrides,
  })
}

test('an empty agent list with code tools on names the ACP page', () => {
  const notice = hint()
  assert.equal(notice.kind, 'unconfigured')
  assert.match(notice.label, /设置 → ACP/, 'the label has to carry the path: the notice cannot open Settings itself')
  assert.match(notice.detail, /还没有 agent/)
  assert.match(notice.detail, /不用重启/, 'the notice explains that saving takes effect without a restart')
})

test('a closed code-tools switch is named instead, because the fix is elsewhere', () => {
  const notice = hint({ developerTools: false })
  assert.equal(notice.kind, 'presets-off')
  assert.match(notice.label, /通用设置/)
  assert.match(notice.detail, /代码工作工具/)
  assert.doesNotMatch(notice.detail, /设置 → ACP/, 'sending someone to the ACP page would be a dead end here')
})

test('a configured agent silences the notice whatever the code-tools switch says', () => {
  const configured = { agents: [{ name: 'cursor', command: 'cursor-agent' }] }
  assert.equal(hint({ value: configured }), undefined)
  assert.equal(hint({ value: configured, developerTools: false }), undefined)
})

test('an entry that cannot be read still counts as configured', () => {
  // The list is not empty, so "add an agent" would be wrong advice; the settings
  // page is where the unreadable entry gets its diagnostic.
  assert.equal(hint({ value: { agents: ['not an object'] } }), undefined)
})

test('a form that is not ready says nothing', () => {
  // `loading` has no value to judge and `unavailable` has no row to configure;
  // the settings page is where a missing ACP component is explained.
  assert.equal(hint({ status: 'loading', value: undefined }), undefined)
  assert.equal(hint({ status: 'unavailable', value: undefined }), undefined)
})

test('a Session that has already run says nothing, whatever the ACP state is', () => {
  // The mode menu this notice is about exists only on the new-session screen, so
  // in a running conversation the same sentence would be a non-sequitur.
  assert.equal(hint({ blank: false }), undefined)
  assert.equal(hint({ blank: false, developerTools: false }), undefined)
})

test('a dismissal outranks every state', () => {
  assert.equal(hint({ dismissed: true }), undefined)
  assert.equal(hint({ dismissed: true, developerTools: false }), undefined)
})

test('a value the row never wrote reads as an empty list, not as configured', () => {
  assert.equal(hint({ value: undefined }).kind, 'unconfigured')
  assert.equal(hint({ value: {} }).kind, 'unconfigured')
  assert.equal(hint({ value: { agents: undefined } }).kind, 'unconfigured')
})
