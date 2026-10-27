/**
 * Captured-ish git output used by parser unit tests.
 *
 * The shapes follow git 2.45 on Windows/Linux (see docs/git-workspace-spec.md
 * §5.6.4): NUL-separated records, `%x1f` fields in `log -z`, and rename
 * entries whose two paths occupy separate NUL fields.
 *
 * @module dsh-session-map/git-workspace/testing/output-fixtures
 */

/** `status --porcelain=v2 -z --branch --show-stash` with ordinary, rename, unmerged and untracked rows. */
export const STATUS_V2 = [
  '# branch.oid 40159af4c0f4c7b1a2d3e4f50617283940a1b2c3',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '# stash 1',
  '1 .M N... 100644 100644 100644 3e5abd0000000000000000000000000000000000 3e5abd0000000000000000000000000000000000 modified.txt',
  '1 M. N... 100644 100644 100644 3e5abd0000000000000000000000000000000000 3e5abd0000000000000000000000000000000000 staged.txt',
  '2 R. N... 100644 100644 100644 5a72eb0000000000000000000000000000000000 5a72eb0000000000000000000000000000000000 R100 renamed space.txt',
  'new name with space.txt',
  'u UU N... 100644 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 3333333333333333333333333333333333333333 conflict.txt',
  '? untracked dir/',
  '? lonely.txt',
  '! ignored.log',
].join('\0') + '\0'

/** `for-each-ref --format=…` output; fields are NUL separated, refs by newline. */
export const FOR_EACH_REF = [
  [
    'refs/heads/main', 'main', '40159af4c0f4c7b1a2d3e4f50617283940a1b2c3', '40159af',
    'origin/main', '[ahead 2, behind 1]', '*', '2026-10-27T15:04:00+08:00', 'Merge branch v2.1',
  ].join('\0'),
  [
    'refs/heads/side', 'side', '2222222222222222222222222222222222222222', '2222222',
    '', '', ' ', '2026-10-26T10:00:00+08:00', 'side work',
  ].join('\0'),
  [
    'refs/remotes/origin/main', 'origin/main', '40159af4c0f4c7b1a2d3e4f50617283940a1b2c3', '40159af',
    '', '', ' ', '2026-10-27T15:04:00+08:00', 'Merge branch v2.1',
  ].join('\0'),
  [
    'refs/tags/v2.1', 'v2.1', '3333333333333333333333333333333333333333', '3333333',
    '', '', ' ', '2026-10-25T09:00:00+08:00', 'release v2.1',
  ].join('\0'),
].join('\n') + '\n'

/** `log -z --format=…` records: NUL between commits, `%x1f` between fields. */
const LOG_FIELDS = [
  ['%H', '1111111111111111111111111111111111111111'],
  ['%h', '1111111'],
  ['%P', '2222222222222222222222222222222222222222 3333333333333333333333333333333333333333'],
  ['%an', 'Alice'],
  ['%ae', 'alice@example.com'],
  ['%ad', '2026-10-27T15:04:00+08:00'],
  ['%cn', 'Alice'],
  ['%ce', 'alice@example.com'],
  ['%cd', '2026-10-27T15:04:30+08:00'],
  ['%D', 'HEAD -> main, origin/main, tag: v2.1'],
  ['%s', 'Merge branch v2.1'],
] as const

function logRecord(fields: readonly string[]): string {
  return fields.join('\x1f')
}

/** Two-commit page in the exact `log -z` shape. */
export const LOG_Z = [
  logRecord([...LOG_FIELDS.map(([, value]) => value)]),
  logRecord(['4444444444444444444444444444444444444444', '4444444', '1111111111111111111111111111111111111111',
    'Bob', 'bob@example.com', '2026-10-26T09:00:00+08:00', 'Bob', 'bob@example.com',
    '2026-10-26T09:00:10+08:00', '', 'fix: earlier change']),
].join('\0') + '\0'

/** `show --first-parent --format= --name-status -z -M` for a merge commit. */
export const NAME_STATUS_Z = [
  'A', 'nested/new file.txt',
  'M', 'modified.txt',
  'D', 'removed.txt',
  'R100', 'old name.txt', 'renamed/new name.txt',
  'M', 'binary.png',
].join('\0') + '\0'

/** `show --first-parent --format= --numstat -z -M` for the same commit. */
export const NUMSTAT_Z = [
  '10\t0\tnested/new file.txt',
  '3\t2\tmodified.txt',
  '0\t5\tremoved.txt',
  '0\t0\t',
  'old name.txt',
  'renamed/new name.txt',
  '-\t-\tbinary.png',
].join('\0') + '\0'

/** `stash list -z --format='%gd%x1f%H%x1f%ct%x1f%s'`. */
export const STASH_LIST_Z = [
  ['stash@{0}', '5555555555555555555555555555555555555555', '1761500000', 'WIP on main: fix'],
  ['stash@{1}', '6666666666666666666666666666666666666666', '1761400000', 'WIP on side: experiment'],
].map(fields => fields.join('\x1f')).join('\0') + '\0'

/** One unified diff with two hunks. */
export const UNIFIED_DIFF = [
  'diff --git a/modified.txt b/modified.txt',
  'index 1111111..2222222 100644',
  '--- a/modified.txt',
  '+++ b/modified.txt',
  '@@ -1,3 +1,3 @@',
  ' line one',
  '-old line',
  '+new line',
  ' line three',
  '@@ -10,2 +10,3 @@',
  ' context',
  '+added tail',
  ' end',
].join('\n') + '\n'
