/**
 * Self-tests for the safety harness itself: a fixture that lies about what it
 * recorded would invalidate every test built on it, so each capability gets one
 * direct assertion here.
 *
 * @module dsh-session-map/git-workspace/testing/harness.test
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { FakeSubprocess } from './fake-subprocess'
import { createFakeContext, FakeWebServer, invokeRoute } from './fake-host'
import { createTempRepo, hasGit } from './temp-repo'

describe('FakeSubprocess', () => {
  it('records the exact spawn request and replays a scripted outcome', async () => {
    const subprocess = new FakeSubprocess()
    subprocess.queueOutcome({ exitCode: 0, stdout: 'hello\0', stderr: '' })
    const git = await subprocess.resolveExecutable('git')
    const handle = subprocess.spawn({
      argv: [git, '-C', '/repo', 'status'],
      cwd: '/repo',
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
      graceMs: 2000,
      env: { GIT_TERMINAL_PROMPT: '0' },
    })
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(subprocess.lastArgv()).toEqual([git, '-C', '/repo', 'status'])
    expect(subprocess.spawns[0]?.env).toEqual({ GIT_TERMINAL_PROMPT: '0' })
    expect(handle.collected.stdout?.readFrom(0).text).toBe('hello\0')
    expect(handle.collected.stdout?.readFrom(6).text).toBe('')
  })

  it('settles a held process when its abort signal fires', async () => {
    const subprocess = new FakeSubprocess()
    subprocess.queueOutcome({ holdUntilAbort: true, stdout: 'partial' })
    const controller = new AbortController()
    const handle = subprocess.spawn({
      argv: ['/usr/bin/git', 'fetch'],
      cwd: '/repo',
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
      graceMs: 2000,
      signal: controller.signal,
    })
    controller.abort()
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
  })

  it('rejects done for a scripted spawn failure', async () => {
    const subprocess = new FakeSubprocess()
    subprocess.queueOutcome({ rejectWith: new Error('spawn failed') })
    const handle = subprocess.spawn({
      argv: ['/usr/bin/git', 'status'],
      cwd: '/repo',
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1 }, stderr: { maxBytes: 1 } },
      graceMs: 1,
    })
    await expect(handle.done).rejects.toThrow('spawn failed')
  })
})

describe('invokeRoute', () => {
  it('runs a registered handler and captures status plus JSON', async () => {
    const server = new FakeWebServer()
    server.register({
      kind: 'prefix',
      path: '/plugin-git-workspace',
      handler: async (request, response) => {
        const req = request as EventEmitter & { headers: Record<string, string> }
        const chunks: Buffer[] = []
        await new Promise<void>((resolve) => {
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', () => resolve())
        })
        const res = response as { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ peer: req.headers['host'], body: Buffer.concat(chunks).toString('utf8') }))
      },
    })
    const result = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/ping',
      body: { hello: 'world' },
    })
    expect(result.status).toBe(200)
    expect(result.json).toEqual({ peer: '127.0.0.1:3080', body: '{"hello":"world"}' })
  })

  it('reports 404 for an unclaimed path', async () => {
    const server = new FakeWebServer()
    const result = await invokeRoute(server, { path: '/plugin-git-workspace/nope' })
    expect(result.status).toBe(404)
  })
})

describe('createFakeContext', () => {
  it('serves services and runs effects', () => {
    const service = { value: 1 }
    const ctx = createFakeContext({ demo: service })
    expect(ctx.get('demo')).toBe(service)
    let ran = false
    ctx.effect(() => {
      ran = true
      return () => undefined
    })
    expect(ran).toBe(true)
  })
})

const describeWithGit = hasGit() ? describe : describe.skip

describeWithGit('TempRepo', () => {
  it('creates a repository, commits and reports status', async () => {
    const repo = await createTempRepo()
    try {
      await repo.write('src/app.ts', 'export const value = 1\n')
      expect(await repo.status()).toContain('src/')
      const hash = await repo.commit('add app')
      expect(hash).toMatch(/^[0-9a-f]{40}$/)
      expect(await repo.currentBranch()).toBe('master')
      expect(await repo.status()).toBe('')
    } finally {
      await repo.dispose()
    }
  })

  it('leaves a merge conflict in progress', async () => {
    const repo = await createTempRepo()
    try {
      await repo.mergeConflict()
      expect(await repo.status()).toContain('conflict.txt')
      const result = await repo.tryGit(['rev-parse', '--git-path', 'MERGE_HEAD'])
      expect(result.code).toBe(0)
    } finally {
      await repo.dispose()
    }
  })
})
