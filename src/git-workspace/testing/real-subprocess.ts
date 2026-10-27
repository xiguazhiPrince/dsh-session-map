/**
 * Real local subprocess seam for integration tests.
 *
 * Production never spawns directly; this adapter exists only so route-level
 * integration tests can exercise real git behind the same structural contract
 * the Host reads.
 *
 * @module dsh-session-map/git-workspace/testing/real-subprocess
 */
import { spawn } from 'node:child_process'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessService,
  SubprocessSpawnSpec,
} from '../host-process'

/** One collected stream with offset reads. */
function readerOf(text: string): { readFrom(fromByte: number): { text: string; nextOffset: number; lossy: boolean } } {
  return {
    readFrom(fromByte: number) {
      const start = Math.max(0, Math.min(fromByte, text.length))
      return { text: text.slice(start), nextOffset: text.length, lossy: false }
    },
  }
}

/** One real local process. */
class LocalHandle implements SubprocessHandle {
  readonly done: Promise<SubprocessOutcome>
  private readonly stdoutChunks: Buffer[] = []
  private readonly stderrChunks: Buffer[] = []
  private readonly child: ReturnType<typeof spawn>
  private readonly exit: Promise<SubprocessOutcome>

  constructor(spec: SubprocessSpawnSpec) {
    const child = spawn(spec.argv[0] as string, spec.argv.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout?.on('data', (chunk: Buffer) => this.stdoutChunks.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => this.stderrChunks.push(chunk))
    this.exit = new Promise<SubprocessOutcome>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
    })
    this.done = this.exit
    spec.signal?.addEventListener('abort', () => { child.kill('SIGTERM') }, { once: true })
  }

  // Readers are built on access: the collected arrays keep filling until the
  // process closes, and the Host reads them only after `done`.
  get collected(): {
    readonly stdout: ReturnType<typeof readerOf>
    readonly stderr: ReturnType<typeof readerOf>
  } {
    return {
      stdout: readerOf(Buffer.concat(this.stdoutChunks).toString('utf8')),
      stderr: readerOf(Buffer.concat(this.stderrChunks).toString('utf8')),
    }
  }

  terminate(): void {
    this.child.kill('SIGTERM')
  }

  async waitForExit(): Promise<boolean> {
    await this.exit.catch(() => undefined)
    return true
  }
}

/** Minimal real subprocess service for integration tests. */
export class LocalSubprocess implements SubprocessService {
  readonly spawns: SubprocessSpawnSpec[] = []

  async resolveExecutable(command: string): Promise<string> {
    return command
  }

  async terminalEnvironment(): Promise<{ platform: 'posix' | 'windows' }> {
    return { platform: process.platform === 'win32' ? 'windows' : 'posix' }
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    return new LocalHandle(spec)
  }
}
