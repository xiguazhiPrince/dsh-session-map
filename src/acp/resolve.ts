/**
 * Environment resolution: the child's working directory, and the argv to spawn.
 *
 * This is the only place that knows anything about how a CLI is installed.
 * Everything else is driven by the row's configuration, so the same component
 * serves any ACP agent.
 *
 * The process seam never interprets a shell (`argv[0]` IS the program) and
 * offers no verbatim-command-line escape hatch, which decides the Windows
 * ladder below. An installed CLI is usually a `.cmd` shim, and CreateProcess
 * cannot start one, so the ladder tries, in order:
 *
 * 1. a {@link knownLaunchers} entry, for a CLI whose installer keeps the real
 *    entry point somewhere a bare spawn cannot reach;
 * 2. the shim's OWN target, parsed out of the npm/`cmd-shim` template line
 *    (`"%dp0%\<relative>"`) — this is what makes an npm-installed CLI work
 *    without knowing anything about it, spaces in the install path included;
 * 3. the command interpreter, for a shim that names no parseable target — only
 *    when the resulting command line is provably safe to hand over unescaped.
 *
 * @module dsh-session-map/acp/resolve
 */
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join } from 'node:path'

/** Subdirectory of `%LOCALAPPDATA%\cursor-agent` holding one directory per installed version. */
const CURSOR_VERSIONS_SUBDIR = join('cursor-agent', 'versions')

/** The runtime entry file inside a versioned Cursor directory. */
const CURSOR_ENTRY_FILE = 'index.js'

/** The bundled Node executable inside a versioned Cursor directory. */
const CURSOR_NODE_FILE = 'node.exe'

/** Windows shim extensions that CreateProcess cannot start directly. */
const WINDOWS_SHIM_EXTENSIONS = ['.cmd', '.bat'] as const

/** Directly executable Windows extension, preferred over a shim on `PATH`. */
const WINDOWS_EXECUTABLE_EXTENSION = '.exe'

/** Script extensions that need a JavaScript runtime in front of them. */
const SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs'] as const

/**
 * The npm/`cmd-shim` template: the launcher names its real target relative to
 * its own directory, and prepends `%_prog%` (Node) when that target is a script
 * rather than a binary. pnpm and Yarn write the same shape.
 */
const SHIM_TARGET_PATTERN = /"%dp0%[\\/]([^"]+)"/

/**
 * Command names whose installed entry point a bare spawn cannot reach, and how
 * to reach it. This is the documented extension point for a CLI the generic
 * ladder below serves badly — and it is only ever a shortcut: removing an entry
 * costs the slower generic route, never correctness.
 * @param command - the configured command name.
 * @param platform - the platform whose layout applies.
 * @param env - the process environment.
 * @returns the argv prefix (entry point) to prepend to the configured args, or
 *   `undefined` when this table does not apply.
 */
function knownLaunchers(command: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): readonly string[] | undefined {
  if (platform !== 'win32') return undefined
  // Cursor's installer keeps `node.exe` plus `index.js` under a per-version
  // directory and ships a `.cmd` that delegates to PowerShell. The generic
  // ladder would reach it through the interpreter and a PowerShell hop; naming
  // the real entry point keeps the JSON-RPC stream on a direct pipe.
  if (command !== 'cursor-agent' && command !== 'agent') return undefined
  const localAppData = env['LOCALAPPDATA']
  if (localAppData === undefined || localAppData === '') return undefined
  const runtime = newestVersionedRuntime(join(localAppData, CURSOR_VERSIONS_SUBDIR))
  return runtime === undefined
    ? undefined
    : [join(runtime, CURSOR_NODE_FILE), join(runtime, CURSOR_ENTRY_FILE)]
}

/**
 * Whether `path` names an existing regular file.
 * @param path - candidate path.
 * @returns whether it exists and is a file.
 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Whether `path` names an existing directory the Harness can ENTER. The search
 * permission probe matters: `statSync().isDirectory()` is true for a mode-600
 * directory, but a subprocess cwd needs `X_OK` or the spawn fails EACCES.
 * @param path - candidate directory.
 * @returns whether the directory exists and is enterable.
 */
function isEnterableDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    // Every throw here (ENOENT/EACCES/ENOTDIR/…) means the path cannot serve as
    // the child's cwd.
    return false
  }
}

/**
 * Assert a working directory can actually host the child: absolute (it doubles
 * as the child's workspace identity, and a relative path would be re-anchored to
 * the server process's launch directory) and an existing enterable directory
 * (fail here, before the process boundary, instead of as an ambiguous ENOENT).
 * @param prefix - this plugin's diagnostic prefix.
 * @param label - which source supplied the value, for the diagnostic.
 * @param cwd - the candidate working directory.
 * @returns `cwd`, validated.
 */
export function assertUsableCwd(prefix: string, label: string, cwd: string): string {
  if (!isAbsolute(cwd)) {
    throw new Error(`${prefix}: ${label} must be an absolute path: ${cwd}`)
  }
  if (!isEnterableDirectory(cwd)) {
    throw new Error(`${prefix}: ${label} is not an accessible directory: ${cwd}`)
  }
  return cwd
}

/**
 * Resolve the child's working directory: the configured override when present
 * (already validated at load), else the delegating parent session's workspace
 * (validated here, its earliest resolvable point). Failing loud when neither
 * exists is deliberate — falling back to the Harness process cwd would silently
 * bind the child to the server's launch directory instead of the delegating
 * session's workspace.
 * @param prefix - this plugin's diagnostic prefix.
 * @param configured - the load-validated override, or `undefined`.
 * @param parentCwd - the delegating parent session's workspace cwd, if any.
 * @returns the absolute child working directory.
 */
export function resolveChildCwd(prefix: string, configured: string | undefined, parentCwd: string | undefined): string {
  if (configured !== undefined) return configured
  if (parentCwd === undefined) {
    throw new Error(`${prefix}: no working directory for the child — configure \`cwd\` or delegate from a parent session that has one`)
  }
  return assertUsableCwd(prefix, 'parent session cwd', parentCwd)
}

/**
 * The versioned runtime directory to use, newest first. Names are
 * `YYYY.MM.DD-<rev>` (a lexicographic descending order is also chronological
 * order for that prefix), plus installer archive files that are not
 * directories. Every candidate is probed for BOTH runtime files, so a
 * non-runtime directory, a partially unpacked version, or a future layout
 * change is skipped rather than fatal.
 * @param baseDir - the versioned root, e.g. `%LOCALAPPDATA%\cursor-agent\versions`.
 * @returns the newest usable versioned directory, or `undefined`.
 */
function newestVersionedRuntime(baseDir: string): string | undefined {
  let names: string[]
  try {
    names = readdirSync(baseDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    // No such installation on this machine.
    return undefined
  }
  for (const name of names.sort((a, b) => b.localeCompare(a, 'en'))) {
    const dir = join(baseDir, name)
    if (existsSync(join(dir, CURSOR_NODE_FILE)) && existsSync(join(dir, CURSOR_ENTRY_FILE))) return dir
  }
  return undefined
}

/** Whether a path is a Windows shim the process seam cannot start directly. */
function isWindowsShim(path: string): boolean {
  const lower = path.toLowerCase()
  return WINDOWS_SHIM_EXTENSIONS.some(extension => lower.endsWith(extension))
}

/**
 * Find a bare command name on `PATH`, preferring a directly executable `.exe`
 * anywhere on `PATH` over a `.cmd`/`.bat` shim that appears earlier. An
 * extensionless file is skipped: Windows cannot start it.
 * @param command - the bare command name.
 * @param env - the process environment (`PATH`).
 * @returns the absolute path of the found file, or `undefined`.
 */
function searchPath(command: string, env: NodeJS.ProcessEnv): string | undefined {
  const path = env['PATH'] ?? env['Path']
  if (path === undefined || path === '') return undefined
  const dirs = path.split(delimiter).filter(dir => dir !== '')
  for (const dir of dirs) {
    const executable = join(dir, command + WINDOWS_EXECUTABLE_EXTENSION)
    if (isFile(executable)) return executable
  }
  for (const dir of dirs) {
    for (const extension of WINDOWS_SHIM_EXTENSIONS) {
      const shim = join(dir, command + extension)
      if (isFile(shim)) return shim
    }
  }
  return undefined
}

/** Whether a value looks like a path rather than a bare command name. */
function isPathLike(command: string): boolean {
  return isAbsolute(command) || command.includes('/') || command.includes('\\')
}

/**
 * A shim's declared target, and whether the shim runs it through a runtime.
 */
interface ShimTarget {
  /** Absolute path of the target program or script. */
  readonly target: string
  /** Whether the shim invoked it through `%_prog%` (Node) rather than directly. */
  readonly needsRuntime: boolean
}

/**
 * Read a shim's declared target. An installed CLI normally ships a tiny launcher
 * that names the real program relative to itself; running that program directly
 * keeps argv elements separate and needs no command-line escaping at all.
 * @param shimPath - the `.cmd`/`.bat` path found on disk.
 * @returns the target and whether a runtime sits in front of it, or `undefined`
 *   when the shim declares no target this driver can locate.
 */
function shimTarget(shimPath: string): ShimTarget | undefined {
  let text: string
  try {
    text = readFileSync(shimPath, 'utf8')
  } catch {
    return undefined
  }
  const line = text.split('\n').find(candidate => candidate.includes('"%dp0%'))
  if (line === undefined) return undefined
  const relative = SHIM_TARGET_PATTERN.exec(line)?.[1]
  if (relative === undefined) return undefined
  const target = join(dirname(shimPath), relative)
  if (!isFile(target)) return undefined
  const isScript = SCRIPT_EXTENSIONS.some(extension => target.toLowerCase().endsWith(extension))
  return { target, needsRuntime: isScript || line.includes('%_prog%') }
}

/**
 * The argv for a shim whose target was resolved. A script target needs a
 * JavaScript runtime: the one installed beside the shim (npm does this for a
 * bundled runtime), else `node` from `PATH`.
 * @param shimPath - the shim path, whose directory may hold a bundled runtime.
 * @param resolved - the resolved target and whether it needs a runtime.
 * @param args - the configured arguments.
 * @param env - the process environment (`PATH`).
 * @returns the argv, or `undefined` when a script target has no runtime.
 */
function viaShimTarget(
  shimPath: string,
  resolved: ShimTarget,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): readonly string[] | undefined {
  if (!resolved.needsRuntime) return [resolved.target, ...args]
  const shimDir = dirname(shimPath)
  const runtime = isFile(join(shimDir, CURSOR_NODE_FILE)) ? join(shimDir, CURSOR_NODE_FILE) : searchPath('node', env)
  return runtime === undefined ? undefined : [runtime, resolved.target, ...args]
}

/**
 * Last resort for a shim that names no parseable target: run it through the
 * command interpreter, using the argv shape Node's own `shell: true` builds.
 *
 * This route CANNOT be made safe in general: the process seam has no
 * `windowsVerbatimArguments`, so Node re-escapes whatever is passed, and an
 * embedded quote reaches `cmd.exe` as a literal backslash-quote. Rather than
 * hand over a command line that will be mangled, a token containing whitespace
 * or a quote is refused with configuration guidance.
 * @param prefix - this plugin's diagnostic prefix.
 * @param shimPath - the shim to run.
 * @param args - the configured arguments.
 * @param env - the process environment (`COMSPEC`).
 * @returns the argv to hand the process seam.
 * @throws when an argument could not survive the round trip.
 */
function viaCommandInterpreter(
  prefix: string,
  shimPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const tokens = [shimPath, ...args]
  if (tokens.some(token => /[\s"]/.test(token))) {
    throw new Error(
      `${prefix}: "${shimPath}" declares no target this driver can run directly, and its command line `
      + 'contains whitespace or a quote, which the command interpreter cannot receive unescaped. '
      + 'Point `command` at an executable (or at a `.js` entry with `command: node`).',
    )
  }
  const comspec = env['COMSPEC'] ?? env['ComSpec'] ?? 'cmd.exe'
  return [comspec, '/d', '/s', '/c', tokens.join(' ')]
}

/** The configured command shape the resolver honours. */
export interface CommandConfig {
  /** The CLI name or an explicit executable path. */
  readonly command: string
  /** Arguments appended after the resolved entry point. */
  readonly args: readonly string[]
}

/**
 * Resolve the argv to spawn for one run.
 *
 * Resolution happens on EVERY run rather than once per process: a self-updating
 * CLI unpacks a new version, and a cached argv would keep the retired one until
 * the whole Harness restarted. The cost is one directory listing and at most one
 * `PATH` scan per delegation.
 * @param prefix - this plugin's diagnostic prefix.
 * @param config - the configured `command` and `args`.
 * @param platform - the platform whose spawn rules apply.
 * @param env - the process environment (`PATH`, `LOCALAPPDATA`, `COMSPEC`).
 * @returns the argv to hand the process seam.
 */
export function resolveAcpCommand(
  prefix: string,
  config: CommandConfig,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const { command, args } = config
  // POSIX spawns a bare name through PATH itself, and every installed CLI there
  // is a real executable.
  if (platform !== 'win32') return [command, ...args]

  const known = knownLaunchers(command, platform, env)
  if (known !== undefined) return [...known, ...args]

  const located = isPathLike(command) ? command : searchPath(command, env)
  if (located === undefined) {
    throw new Error(
      `${prefix}: "${command}" was not found on PATH and is not an absolute path. `
      + 'Point `command` at an executable, or install the CLI so its launcher is on PATH.',
    )
  }
  if (!isWindowsShim(located)) return [located, ...args]

  const target = shimTarget(located)
  if (target !== undefined) {
    const direct = viaShimTarget(located, target, args, env)
    if (direct !== undefined) return direct
  }
  return viaCommandInterpreter(prefix, located, args, env)
}

