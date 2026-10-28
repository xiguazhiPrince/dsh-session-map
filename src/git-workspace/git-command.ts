/**
 * Argv construction for the Git tool window.
 *
 * The Host never accepts a raw command or an arbitrary flag from the page: each
 * operation has one builder here, and every positional that comes from the user
 * (path, ref, message) is placed where git reads it as data. Tests assert the
 * finished argv, so a builder that starts emitting `--force`, `-x` or
 * `--no-verify` fails before it can reach a repository.
 *
 * @module dsh-session-map/git-workspace/git-command
 */
import type { CommandReceipt, GitPlatform } from './git-types'

/** Environment every git invocation inherits from the Host. */
const GIT_BASE_ENV: Readonly<Record<string, string>> = {
  LC_ALL: 'C',
  LANG: 'C',
  LANGUAGE: 'C',
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  GIT_LITERAL_PATHSPECS: '1',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_EDITOR: ':',
  GIT_SEQUENCE_EDITOR: ':',
}

/** Read invocations additionally never take an optional lock. */
export const GIT_READ_ENV: Readonly<Record<string, string>> = {
  ...GIT_BASE_ENV,
  GIT_OPTIONAL_LOCKS: '0',
}

/** Write invocations keep their locks but still fail instead of opening an editor. */
export const GIT_WRITE_ENV: Readonly<Record<string, string>> = {
  ...GIT_BASE_ENV,
}

/** Default read timeout; status/log/diff on large repositories may take longer. */
export const DEFAULT_READ_TIMEOUT_MS = 10_000
/** Default write timeout. */
export const DEFAULT_WRITE_TIMEOUT_MS = 60_000
/** Default collected-output cap per stream. */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

/** One fully specified git invocation, ready for `subprocess.spawn`. */
export interface GitInvocation {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly maxBytes: number
  /** Short label shown in the console and used by tests. */
  readonly label: string
}

/** Optional overrides for one invocation. */
export interface InvocationOptions {
  readonly timeoutMs?: number
  readonly maxBytes?: number
  readonly label?: string
}

/** `for-each-ref` field layout; fields are NUL separated, refs newline separated. */
export const FOR_EACH_REF_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname)',
  '%(objecttype)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(HEAD)',
  '%(committerdate:iso-strict)',
  '%(contents:subject)',
].join('%00')

/** `log` field layout; records are NUL separated, fields `%x1f` separated. */
export const LOG_FORMAT = [
  '%H', '%h', '%P', '%an', '%ae', '%ad', '%cn', '%ce', '%cd', '%D', '%s',
].join('%x1f')

/** Commit metadata format used by the detail route. */
export const COMMIT_META_FORMAT = [
  '%H', '%h', '%P', '%an', '%ae', '%ad', '%cn', '%ce', '%cd', '%D', '%s', '%B',
].join('%x1f')

/** Common display directives every invocation carries. */
const DISPLAY_CONFIG = [
  '-c', 'core.quotepath=false',
  '-c', 'color.ui=false',
  '-c', 'core.pager=cat',
]

/** Read-only directives: no pager, no optional locks, no signature checks. */
const READ_DIRECTIVES = [
  '--no-pager',
  '--no-optional-locks',
  ...DISPLAY_CONFIG,
  '-c', 'log.showSignature=false',
  '-c', 'i18n.logOutputEncoding=UTF-8',
]

/** Write directives: no pager; an accidental editor request fails instead of hanging. */
const WRITE_DIRECTIVES = [
  '--no-pager',
  ...DISPLAY_CONFIG,
  '-c', 'core.editor=false',
  '-c', 'sequence.editor=false',
]

/**
 * Build one read invocation.
 * @param gitPath - resolved absolute git executable.
 * @param root - repository root as cwd.
 * @param args - subcommand plus its arguments.
 * @param options - timeout and output overrides.
 * @returns the invocation.
 */
export function readInvocation(
  gitPath: string,
  root: string,
  args: readonly string[],
  options: InvocationOptions = {},
): GitInvocation {
  return {
    argv: [gitPath, '-C', root, ...READ_DIRECTIVES, ...args],
    cwd: root,
    env: GIT_READ_ENV,
    timeoutMs: options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    label: options.label ?? args[0] ?? 'git',
  }
}

/**
 * Build one write invocation.
 * @param gitPath - resolved absolute git executable.
 * @param root - repository root as cwd.
 * @param args - subcommand plus its arguments.
 * @param options - timeout and output overrides.
 * @returns the invocation.
 */
export function writeInvocation(
  gitPath: string,
  root: string,
  args: readonly string[],
  options: InvocationOptions = {},
): GitInvocation {
  return {
    argv: [gitPath, '-C', root, ...WRITE_DIRECTIVES, ...args],
    cwd: root,
    env: GIT_WRITE_ENV,
    timeoutMs: options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    label: options.label ?? args[0] ?? 'git',
  }
}

/** Repository probe arguments; output order matches this list. */
export function repoProbeArgs(): readonly string[] {
  return [
    'rev-parse',
    '--is-inside-work-tree',
    '--show-toplevel',
    '--show-prefix',
    '--is-bare-repository',
    '--absolute-git-dir',
    '--git-common-dir',
  ]
}

/** `status --porcelain=v2 -z` with the branch and stash headers. */
export function statusArgs(untracked: 'no' | 'normal' | 'all'): readonly string[] {
  return [
    'status',
    '--porcelain=v2',
    '-z',
    '--branch',
    '--show-stash',
    `--untracked-files=${untracked}`,
  ]
}

/** `symbolic-ref -q --short HEAD`; exit 1 means detached. */
export function symbolicRefArgs(): readonly string[] {
  return ['symbolic-ref', '-q', '--short', 'HEAD']
}

/** `rev-parse HEAD`; exit 128 means unborn. */
export function headOidArgs(): readonly string[] {
  return ['rev-parse', 'HEAD']
}

/** `for-each-ref` over heads, remotes and tags. */
export function forEachRefArgs(): readonly string[] {
  return [
    'for-each-ref',
    `--format=${FOR_EACH_REF_FORMAT}`,
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]
}

/** `stash list -z` with a stable `stash@{n}` selector. */
export function stashListArgs(): readonly string[] {
  return ['stash', 'list', '-z', '--format=%gd%x1f%H%x1f%ct%x1f%s']
}

/** `rev-parse --git-path` for each marker file. */
export function gitPathArgs(names: readonly string[]): readonly string[] {
  const args: string[] = ['rev-parse']
  for (const name of names) args.push('--git-path', name)
  return args
}

/** `config --get <key>`; exit 1 means unset. */
export function configGetArgs(key: string): readonly string[] {
  return ['config', '--get', key]
}

/** `remote -v`. */
export function remoteVerboseArgs(): readonly string[] {
  return ['remote', '-v']
}

/** Filters the log route applies before the path separator. */
export interface LogFilterParams {
  readonly ref?: string | undefined
  readonly allBranches?: boolean | undefined
  readonly limit: number
  readonly skip: number
  readonly query?: string | undefined
  readonly author?: string | undefined
  readonly since?: string | undefined
  readonly until?: string | undefined
  readonly file?: string | undefined
}

/** `log` page arguments. */
export function logArgs(params: LogFilterParams): readonly string[] {
  const args: string[] = ['log']
  if (params.allBranches === true) args.push('--all')
  else args.push(params.ref ?? 'HEAD')
  args.push(`--max-count=${params.limit}`, `--skip=${params.skip}`, '--date=iso-strict', '-z', `--format=${LOG_FORMAT}`)
  if (params.query !== undefined && params.query !== '') {
    args.push(`--grep=${params.query}`, '--regexp-ignore-case', '--fixed-strings')
  }
  if (params.author !== undefined && params.author !== '') args.push(`--author=${params.author}`)
  if (params.since !== undefined && params.since !== '') args.push(`--since=${params.since}`)
  if (params.until !== undefined && params.until !== '') args.push(`--until=${params.until}`)
  if (params.file !== undefined) args.push('--', params.file)
  return args
}

/** `show -s` commit metadata. */
export function commitMetaArgs(hash: string): readonly string[] {
  return ['show', '-s', '-z', `--format=${COMMIT_META_FORMAT}`, hash]
}

/** `show --first-parent --name-status`; the only reliable file list for merges. */
export function commitFilesArgs(hash: string): readonly string[] {
  return ['show', '--first-parent', '--format=', '--name-status', '-z', '-M', hash]
}

/** `show --first-parent --numstat`. */
export function commitNumstatArgs(hash: string): readonly string[] {
  return ['show', '--first-parent', '--format=', '--numstat', '-z', '-M', hash]
}

/** Files changed between the merge base of `base` and HEAD (push preview). */
export function rangeFilesArgs(base: string): readonly string[] {
  return ['diff', '--name-status', '-z', '-M', `${base}...HEAD`]
}

/** Line stats between the merge base of `base` and HEAD (push preview). */
export function rangeNumstatArgs(base: string): readonly string[] {
  return ['diff', '--numstat', '-z', '-M', `${base}...HEAD`]
}

/** Resolve one ref to its commit id for a read-only comparison. */
export function verifyRefArgs(ref: string): readonly string[] {
  return ['rev-parse', '--verify', `${ref}^{commit}`]
}

/** The current branch's upstream ref, or a failing exit when none is set. */
export function upstreamRefArgs(): readonly string[] {
  return ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']
}

/** Branches and remote branches whose tip contains the commit. */
export function containsArgs(hash: string): readonly string[] {
  return [
    'for-each-ref',
    '--contains', hash,
    '--format=%(refname:short)',
    'refs/heads',
    'refs/remotes',
  ]
}

/** `rev-parse --verify <hash>^{commit}` for a hash-prefix search. */
export function verifyCommitArgs(value: string): readonly string[] {
  return ['rev-parse', '--verify', `${value}^{commit}`]
}

/** One diff request. */
export interface DiffParams {
  readonly hash?: string | undefined
  /** Optional older revision: diff from this commit to `hash`. */
  readonly from?: string | undefined
  readonly file: string
  readonly staged?: boolean | undefined
  readonly context: number
}

/** Diff arguments for a commit, the index or the working tree. */
export function diffArgs(params: DiffParams): readonly string[] {
  const common = [
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    `--unified=${params.context}`,
  ]
  if (params.hash !== undefined && params.from !== undefined) {
    return ['diff', ...common, params.from, params.hash, '--', params.file]
  }
  if (params.hash !== undefined) {
    return ['show', '--format=', '--patch', ...common, params.hash, '--', params.file]
  }
  const cached = params.staged === true ? ['--cached'] : []
  return ['diff', ...cached, ...common, '--', params.file]
}

/**
 * Redact credentials embedded in a URL-like argv element.
 * @param value - one argv element.
 * @returns the element with any `user:secret@` part replaced.
 */
export function redactArg(value: string): string {
  return value.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@\s]+@/, '$1***@')
}

/**
 * Redact one finished receipt before it reaches the browser console.
 * @param argv - spawned argv.
 * @returns a redacted copy.
 */
export function redactArgv(argv: readonly string[]): readonly string[] {
  return argv.map(redactArg)
}

/**
 * Build one console receipt.
 * @param invocation - executed invocation.
 * @param exitCode - finished exit code.
 * @param ms - elapsed milliseconds.
 * @param flags - cancellation/truncation facts.
 * @returns the redacted receipt.
 */
export function receiptOf(
  invocation: GitInvocation,
  exitCode: number | null,
  ms: number,
  flags: { readonly cancelled?: boolean; readonly truncated?: boolean } = {},
): CommandReceipt {
  return {
    argv: redactArgv(invocation.argv),
    cwd: invocation.cwd,
    exitCode,
    ms,
    ...(flags.cancelled === true ? { cancelled: true } : {}),
    ...(flags.truncated === true ? { truncated: true } : {}),
  }
}

/** Environment values a test or the Host wants to assert. */
export function gitEnvironment(write: boolean): Readonly<Record<string, string>> {
  return write ? GIT_WRITE_ENV : GIT_READ_ENV
}

/** Platform-aware PATH separator used only for display of cwd. */
export function displayPath(value: string, platform: GitPlatform): string {
  return platform === 'windows' ? value.replace(/\//g, '\\') : value
}
