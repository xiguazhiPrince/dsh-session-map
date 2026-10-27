/**
 * Real-git fixture for integration tests: one throwaway repository per test,
 * built with ordinary `git` commands through a child process.
 *
 * This module is the only test utility allowed to import `node:child_process`;
 * production sources are guarded against it.
 *
 * @module dsh-session-map/git-workspace/testing/temp-repo
 */
import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Environment every fixture git call runs under. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  LC_ALL: 'C',
}

/** Whether a usable git executable exists on this machine. */
export function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** One created repository under the OS temp directory. */
export interface TempRepo {
  readonly dir: string
  /** Run git in the repository; resolves with trimmed stdout. */
  git(args: string[]): Promise<string>
  /** Run git and return the raw finished result; never throws for exit 1. */
  tryGit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }>
  /** Write one repository-relative file, creating parent directories. */
  write(path: string, content: string): Promise<void>
  /** Read one repository-relative file. */
  read(path: string): Promise<string>
  /** Absolute path for one repository-relative path. */
  path(path: string): string
  /** Stage everything and commit. */
  commit(message: string): Promise<string>
  /** Create a branch at the current HEAD. */
  branch(name: string): Promise<void>
  /** Create and switch to a branch. */
  checkoutNew(name: string): Promise<void>
  /** Switch to an existing branch. */
  checkout(name: string): Promise<void>
  /** Current branch name. */
  currentBranch(): Promise<string>
  /** Full HEAD hash. */
  headHash(): Promise<string>
  /** `status --porcelain` text. */
  status(): Promise<string>
  /** Drop an `index.lock` into the repository. */
  lockIndex(): Promise<void>
  /** Remove that lock again. */
  unlockIndex(): Promise<void>
  /** Create a bare remote and wire it as `origin`. */
  createBareOrigin(): Promise<string>
  /** Create two branches that conflict on the same line, leaving a merge in progress. */
  mergeConflict(): Promise<void>
  /** Delete the repository tree. */
  dispose(): Promise<void>
}

/**
 * Create one initialized repository with a first commit.
 * @param options - optional initial user identity.
 * @returns the repository handle.
 */
export async function createTempRepo(options: { readonly userName?: string; readonly userEmail?: string } = {}): Promise<TempRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-gw-'))
  const run = async (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    try {
      const result = await execFileAsync('git', ['-C', dir, ...args], { env: GIT_ENV, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
      return { code: 0, stdout: result.stdout, stderr: result.stderr }
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string }
      return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
    }
  }

  await run(['init', '-q'])
  await run(['config', 'user.name', options.userName ?? 'Test User'])
  await run(['config', 'user.email', options.userEmail ?? 'test@example.com'])
  await run(['config', 'commit.gpgsign', 'false'])
  await writeFile(join(dir, 'README.md'), '# fixture\n', 'utf8')
  await run(['add', '-A'])
  await run(['commit', '-q', '-m', 'initial'])

  const repo: TempRepo = {
    dir,
    async git(args: string[]): Promise<string> {
      const result = await run(args)
      if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed (${result.code}): ${result.stderr.trim()}`)
      return result.stdout.trim()
    },
    tryGit: run,
    async write(path: string, content: string): Promise<void> {
      const target = join(dir, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
    },
    async read(path: string): Promise<string> {
      return await readFile(join(dir, path), 'utf8')
    },
    path(path: string): string {
      return join(dir, path)
    },
    async commit(message: string): Promise<string> {
      await run(['add', '-A'])
      await run(['commit', '-q', '-m', message])
      return (await run(['rev-parse', 'HEAD'])).stdout.trim()
    },
    async branch(name: string): Promise<void> {
      const result = await run(['branch', name])
      if (result.code !== 0) throw new Error(result.stderr)
    },
    async checkoutNew(name: string): Promise<void> {
      const result = await run(['switch', '-q', '-c', name])
      if (result.code !== 0) throw new Error(result.stderr)
    },
    async checkout(name: string): Promise<void> {
      const result = await run(['switch', '-q', name])
      if (result.code !== 0) throw new Error(result.stderr)
    },
    async currentBranch(): Promise<string> {
      return (await run(['branch', '--show-current'])).stdout.trim()
    },
    async headHash(): Promise<string> {
      return (await run(['rev-parse', 'HEAD'])).stdout.trim()
    },
    async status(): Promise<string> {
      return (await run(['status', '--porcelain'])).stdout
    },
    async lockIndex(): Promise<void> {
      await writeFile(join(dir, '.git', 'index.lock'), 'locked by test\n', 'utf8')
    },
    async unlockIndex(): Promise<void> {
      await rm(join(dir, '.git', 'index.lock'), { force: true })
    },
    async createBareOrigin(): Promise<string> {
      const bare = await mkdtemp(join(tmpdir(), 'dsh-gw-origin-'))
      await execFileAsync('git', ['init', '--bare', '-q', bare], { env: GIT_ENV, timeout: 30_000 })
      await run(['remote', 'add', 'origin', bare])
      return bare
    },
    async mergeConflict(): Promise<void> {
      await run(['switch', '-q', '-c', 'side'])
      await writeFile(join(dir, 'conflict.txt'), 'side\n', 'utf8')
      await run(['add', '-A'])
      await run(['commit', '-q', '-m', 'side'])
      await run(['switch', '-q', 'master'])
      await writeFile(join(dir, 'conflict.txt'), 'master\n', 'utf8')
      await run(['add', '-A'])
      await run(['commit', '-q', '-m', 'master'])
      await run(['merge', 'side'])
    },
    async dispose(): Promise<void> {
      await rm(dir, { recursive: true, force: true })
    },
  }
  return repo
}
