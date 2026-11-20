/**
 * Host tests for the MCP manager: patch I/O under a temp profile, and the
 * `/plugin-mcp-manager` route envelopes over the production trust gate.
 *
 * @module dsh-session-map/mcp-manager/host.test
 */
import type { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeContext,
  FakeWebServer,
  invokeRoute,
} from '../git-workspace/testing/fake-host'
import {
  classifyUnmanaged,
  buildManagerState,
  clearOAuthFlows,
  clearProbeCache,
  detectProfileDir,
  installMcpManagerHost,
  loadPatchRows,
  profileDirFromOwnPath,
  resolvePatchFile,
  resolveProfileDir,
  scanUnmanagedRows,
  writePatchRows,
} from './host'
import {
  MCP_BLOCK_BEGIN,
  MCP_BLOCK_END,
  MCP_CLIENT_PACKAGE,
  MCP_MANAGER_ROUTE,
  type McpManagerState,
  type McpPatchRow,
} from './model'

/** Directories created by one test, removed afterwards. */
const created: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  clearProbeCache()
  clearOAuthFlows()
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** Create one throwaway directory under the OS temp root. */
async function makeTempDir(prefix = 'dsh-mcp-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

/** Point the Host at a throwaway profile directory. */
async function stubProfile(): Promise<{ readonly dir: string; readonly patchFile: string }> {
  const dir = await makeTempDir()
  const profileDir = join(dir, 'profile')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n', 'utf8')
  vi.stubEnv('DSH_PROFILE_DIR', profileDir)
  vi.stubEnv('DSH_HOME', join(dir, 'home'))
  return { dir, patchFile: join(profileDir, 'cordis.patch.yml') }
}

/** Install the Host routes over a fake web server. */
function installRoutes(services: Readonly<Record<string, unknown>> = {}): FakeWebServer {
  const server = new FakeWebServer()
  const ctx = createFakeContext({ webServer: server, ...services })
  installMcpManagerHost(ctx as unknown as Context)
  return server
}

/** Minimal stdio create payload. */
function stdioBody(name = 'github') {
  return {
    name,
    transport: 'stdio' as const,
    enabled: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: 'secret-token' },
  }
}

describe('patch I/O', () => {
  it('writes and reloads rows inside the marker block', async () => {
    const { patchFile } = await stubProfile()
    const row: McpPatchRow = {
      id: 'mcp-session-map-github',
      name: MCP_CLIENT_PACKAGE,
      config: {
        serverName: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'pkg'],
      },
    }
    await writePatchRows([row])
    const raw = await readFile(patchFile, 'utf8')
    expect(raw).toContain(MCP_BLOCK_BEGIN)
    expect(raw).toContain(MCP_BLOCK_END)
    expect(raw).toContain('mcp-session-map-github')
    expect(resolvePatchFile()).toBe(patchFile)

    const loaded = await loadPatchRows()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.config.serverName).toBe('github')
  })

  it('migrates a legacy dsh-mcp-console block into our markers', async () => {
    const { patchFile } = await stubProfile()
    await writeFile(
      patchFile,
      [
        '# >>> dsh-mcp-console:begin',
        '- insert:',
        '    - id: mcp-console-legacy',
        `      name: "${MCP_CLIENT_PACKAGE}"`,
        '      config:',
        '        serverName: legacy',
        '        transport: stdio',
        '        command: echo',
        '# <<< dsh-mcp-console:end',
        '',
      ].join('\n'),
      'utf8',
    )
    const loaded = await loadPatchRows()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.config.serverName).toBe('legacy')
    const raw = await readFile(patchFile, 'utf8')
    expect(raw).toContain(MCP_BLOCK_BEGIN)
    expect(raw).not.toContain('# >>> dsh-mcp-console:begin')
  })
})

describe('routes', () => {
  it('answers an empty state', async () => {
    await stubProfile()
    const server = installRoutes()
    const response = await invokeRoute(server, { path: `${MCP_MANAGER_ROUTE}/state` })
    expect(response.status).toBe(200)
    const body = response.json as { ok: boolean; state: McpManagerState }
    expect(body.ok).toBe(true)
    expect(body.state.servers).toEqual([])
    expect(body.state.patchFile).toContain('cordis.patch.yml')
  })

  it('saves a stdio server and masks secrets in state', async () => {
    await stubProfile()
    const server = installRoutes()
    const created = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/server`,
      body: stdioBody(),
    })
    expect(created.status).toBe(200)
    const createdBody = created.json as {
      ok: boolean
      server: { name: string; env: Record<string, string>; command: string }
      state: McpManagerState
    }
    expect(createdBody.ok).toBe(true)
    expect(createdBody.server.name).toBe('github')
    expect(createdBody.server.command).toBe('npx')
    expect(createdBody.server.env.GITHUB_TOKEN).toBe('••••••••')
    expect(createdBody.state.servers).toHaveLength(1)

    const state = await invokeRoute(server, { path: `${MCP_MANAGER_ROUTE}/state` })
    expect(state.status).toBe(200)
    const stateBody = state.json as { ok: boolean; state: McpManagerState }
    expect(stateBody.state.servers[0]?.env.GITHUB_TOKEN).toBe('••••••••')

    // Disk still holds the real secret.
    const rows = await loadPatchRows()
    expect(rows[0]?.config.env?.GITHUB_TOKEN).toBe('secret-token')
  })

  it('toggles and removes a server', async () => {
    await stubProfile()
    const server = installRoutes()
    await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/server`,
      body: stdioBody('fs'),
    })

    const toggled = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/toggle`,
      body: { name: 'fs', enabled: false },
    })
    expect(toggled.status).toBe(200)
    const toggledBody = toggled.json as { ok: boolean; state: McpManagerState }
    expect(toggledBody.state.servers[0]?.enabled).toBe(false)
    expect(toggledBody.state.servers[0]?.state).toBe('off')

    const removed = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/remove`,
      body: { name: 'fs' },
    })
    expect(removed.status).toBe(200)
    const removedBody = removed.json as { ok: boolean; state: McpManagerState }
    expect(removedBody.state.servers).toEqual([])
  })

  it('imports and exports mcpServers JSON', async () => {
    await stubProfile()
    const server = installRoutes()
    const imported = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/import`,
      body: {
        text: JSON.stringify({
          mcpServers: {
            github: { command: 'npx', args: ['-y', 'pkg'] },
            docs: { url: 'https://mcp.example.com/docs' },
          },
        }),
      },
    })
    expect(imported.status).toBe(200)
    const importedBody = imported.json as {
      ok: boolean
      imported: string[]
      state: McpManagerState
    }
    expect(importedBody.ok).toBe(true)
    expect(importedBody.imported.sort()).toEqual(['docs', 'github'])
    expect(importedBody.state.servers).toHaveLength(2)

    // Import overwrites by serverName.
    const overwritten = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/import`,
      body: {
        text: JSON.stringify({
          mcpServers: {
            github: { command: 'node', args: ['server.js'] },
          },
        }),
      },
    })
    expect(overwritten.status).toBe(200)
    const rows = await loadPatchRows()
    const github = rows.find((row) => row.config.serverName === 'github')
    expect(github?.config.command).toBe('node')

    const exported = await invokeRoute(server, { path: `${MCP_MANAGER_ROUTE}/export` })
    expect(exported.status).toBe(200)
    const exportedBody = exported.json as {
      ok: boolean
      result: { text: string; format: string }
    }
    expect(exportedBody.result.format).toBe('mcpServers')
    const parsed = JSON.parse(exportedBody.result.text) as {
      mcpServers: Record<string, { command?: string; url?: string }>
    }
    expect(parsed.mcpServers.github?.command).toBe('node')
    expect(parsed.mcpServers.docs?.url).toBe('https://mcp.example.com/docs')
  })

  it('refuses a non-loopback peer before any filesystem work', async () => {
    await stubProfile()
    const server = installRoutes()
    const response = await invokeRoute(server, {
      path: `${MCP_MANAGER_ROUTE}/state`,
      peer: '192.168.1.9',
    })
    expect(response.status).toBe(403)
    expect((response.json as { error: { code: string } }).error.code).toBe('not-trusted')
  })

  it('answers 405 for a wrong method and 404 for an unknown endpoint', async () => {
    await stubProfile()
    const server = installRoutes()
    const wrongMethod = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/state`,
    })
    expect(wrongMethod.status).toBe(405)
    expect((wrongMethod.json as { error: { code: string } }).error.code).toBe('bad-request')

    const unknown = await invokeRoute(server, {
      path: `${MCP_MANAGER_ROUTE}/nope`,
    })
    expect(unknown.status).toBe(404)
    expect((unknown.json as { error: { code: string } }).error.code).toBe('bad-request')
  })

  it('builds state through the exported helper without a live loader', async () => {
    await stubProfile()
    const ctx = createFakeContext({}) as unknown as Context
    await writePatchRows([
      {
        id: 'mcp-session-map-local',
        name: MCP_CLIENT_PACKAGE,
        config: {
          serverName: 'local',
          transport: 'stdio',
          command: 'echo',
        },
      },
    ])
    const state = await buildManagerState(ctx)
    expect(state.servers).toHaveLength(1)
    expect(state.servers[0]?.name).toBe('local')
    expect(state.servers[0]?.state).toBe('down')
    expect(state.servers[0]?.live).toBe(false)
  })

  it('fills toolList from tools.schemas so the detail pane can render names', async () => {
    await stubProfile()
    await writePatchRows([
      {
        id: 'mcp-session-map-motty',
        name: MCP_CLIENT_PACKAGE,
        config: {
          serverName: 'motty',
          transport: 'streamable-http',
          url: 'http://127.0.0.1:52701/mcp',
        },
      },
    ])
    const tools = {
      schemas() {
        return [
          {
            name: 'mcp__motty__list_sessions',
            description: 'List Motty sessions',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'mcp__motty__terminal_exec',
            description: 'Run one command',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string' },
                session: { type: 'string' },
              },
              required: ['command'],
            },
          },
          { name: 'bash', description: 'unrelated' },
        ]
      },
    }
    const ctx = createFakeContext({ tools }) as unknown as Context
    const state = await buildManagerState(ctx)
    expect(state.servers[0]?.tools).toBe(2)
    expect(state.servers[0]?.state).toBe('online')
    expect(state.servers[0]?.toolList).toEqual([
      {
        name: 'list_sessions',
        description: 'List Motty sessions',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'terminal_exec',
        description: 'Run one command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            session: { type: 'string' },
          },
          required: ['command'],
        },
      },
    ])
  })
})

describe('profile resolution', () => {
  it('reads the profile out of an installed package path', () => {
    const own = join('C:', 'Users', 'me', '.dsh', 'profiles', 'web', 'node_modules', '@me', 'pkg')
    expect(profileDirFromOwnPath(own))
      .toBe(join('C:', 'Users', 'me', '.dsh', 'profiles', 'web'))
  })

  it('ignores a path that is not inside a profile', () => {
    expect(profileDirFromOwnPath(join('C:', 'work', 'pkg'))).toBeUndefined()
  })

  it('prefers DSH_PROFILE_DIR, then DSH_PROFILE, then detection', async () => {
    const dir = await makeTempDir()
    const home = join(dir, 'home')
    const profiles = join(home, 'profiles')
    await mkdir(join(profiles, 'web'), { recursive: true })
    await mkdir(join(profiles, 'desktop'), { recursive: true })

    expect(resolveProfileDir({ DSH_PROFILE_DIR: join('x', 'custom') }, home))
      .toBe(resolve(join('x', 'custom')))
    expect(resolveProfileDir({ DSH_PROFILE: 'web', DSH_HOME: home }, home))
      .toBe(join(resolve(home), 'profiles', 'web'))
  })

  it('detects the mounting profile when no profile variable is set', async () => {
    // Stands in for a `link:` install: the package resolves outside every
    // profile, and the profile that mounted it links to that checkout.
    const dir = await makeTempDir()
    const home = join(dir, 'home')
    const checkout = join(dir, 'checkout')
    const profileDir = join(home, 'profiles', 'web')
    await mkdir(join(profileDir, 'node_modules', '@me'), { recursive: true })
    await mkdir(checkout, { recursive: true })
    await writeFile(
      join(checkout, 'package.json'),
      JSON.stringify({ name: '@me/pkg', version: '0.0.0' }),
      'utf8',
    )
    await symlink(checkout, join(profileDir, 'node_modules', '@me', 'pkg'), 'junction')

    // resolveProfileDir runs the real chain against this checkout's own path,
    // so the injected-`own` assertion above is the meaningful one here.
    expect(detectProfileDir({ DSH_HOME: home }, home, realpathSync(checkout)))
      .toBe(resolve(profileDir))
  })

  it('falls back to the desktop profile when nothing identifies one', async () => {
    const dir = await makeTempDir()
    const home = join(dir, 'home')
    await mkdir(join(home, 'profiles'), { recursive: true })
    // No profile links this checkout, and the package is not installed in one.
    expect(resolveProfileDir({ DSH_HOME: home }, home))
      .toBe(join(resolve(home), 'profiles', 'desktop'))
  })
})

describe('reconnect', () => {
  it('re-answers state and rejects an unknown server', async () => {
    await stubProfile()
    await writePatchRows([
      {
        id: 'mcp-session-map-local',
        name: MCP_CLIENT_PACKAGE,
        config: { serverName: 'local', transport: 'stdio', command: 'echo' },
      },
    ])
    const server = installRoutes()

    const retried = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/reconnect`,
      body: { name: 'local' },
    })
    expect(retried.status).toBe(200)
    const body = retried.json as { ok: boolean; state: McpManagerState }
    expect(body.ok).toBe(true)
    expect(body.state.servers).toHaveLength(1)

    const missing = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/reconnect`,
      body: { name: 'ghost' },
    })
    expect(missing.status).toBe(404)
    expect((missing.json as { error: { code: string } }).error.code).toBe('not-found')
  })

  it('holds a failed probe in cache until a fresh read', async () => {
    await stubProfile()
    let status = 500
    const endpoint = createServer((_request, response) => {
      response.statusCode = status
      response.end('probe')
    })
    await new Promise<void>((ready) => endpoint.listen(0, '127.0.0.1', () => { ready() }))
    const port = (endpoint.address() as AddressInfo).port
    try {
      await writePatchRows([
        {
          id: 'mcp-session-map-probe',
          name: MCP_CLIENT_PACKAGE,
          config: {
            serverName: 'probe',
            transport: 'streamable-http',
            url: `http://127.0.0.1:${String(port)}/mcp`,
          },
        },
      ])
      const ctx = createFakeContext({}) as unknown as Context

      const down = await buildManagerState(ctx)
      expect(down.servers[0]?.state).toBe('down')

      // The endpoint recovers, but the cached failure still answers.
      status = 200
      const cached = await buildManagerState(ctx)
      expect(cached.servers[0]?.state).toBe('down')

      // A manual retry bypasses the cache and sees the endpoint again.
      const fresh = await buildManagerState(ctx, process.env, { fresh: true })
      expect(fresh.servers[0]?.state).toBe('idle')
    } finally {
      await new Promise<void>((closed) => endpoint.close(() => { closed() }))
    }
  })
})

describe('unmanaged scan and adoption', () => {
  /**
   * Realistic patch: one managed row inside our marker block, then
   * hand-written rows below it — a sole insert for xterminal and a mixed
   * insert holding yunxiao plus a foreign row that must survive.
   */
  function fixturePatch(): string {
    return [
      '# >>> dsh-session-map:mcp:begin',
      '- insert:',
      '    - id: mcp-session-map-github',
      `      name: "${MCP_CLIENT_PACKAGE}"`,
      '      config:',
      '        serverName: github',
      '        transport: stdio',
      '        command: npx',
      '# <<< dsh-session-map:mcp:end',
      '',
      '# xterminal bridge',
      '- insert:',
      '    - id: mcp-xterminal',
      `      name: "${MCP_CLIENT_PACKAGE}"`,
      '      config:',
      '        serverName: xterminal',
      '        transport: streamable-http',
      '        url: http://127.0.0.1:12335/mcp',
      '        headers:',
      '          Authorization: "Bearer folded',
      '            token-line"',
      '',
      '# mixed insert: yunxiao plus a foreign row',
      '- insert:',
      '    - id: mcp-yunxiao',
      `      name: "${MCP_CLIENT_PACKAGE}"`,
      '      config:',
      '        serverName: yunxiao',
      '        transport: streamable-http',
      '        url: http://127.0.0.1:52702/mcp',
      '    - id: other-tool',
      '      name: "@example/other"',
      '      config: {}',
      '',
    ].join('\n')
  }

  it('scans rows outside the block and skips managed ones', () => {
    const candidates = scanUnmanagedRows(fixturePatch())
    expect(candidates.map((row) => row.name)).toEqual(['xterminal', 'yunxiao'])
    for (const candidate of candidates) {
      expect(candidate.row).not.toBeNull()
      expect(candidate.end).toBeGreaterThan(candidate.start)
      expect(candidate.cutEnd).toBeGreaterThan(candidate.cutStart)
    }
  })

  it('reports a same-name conflict against the managed block', () => {
    const views = classifyUnmanaged(scanUnmanagedRows(fixturePatch()), [
      {
        id: 'mcp-session-map-yunxiao',
        name: MCP_CLIENT_PACKAGE,
        config: { serverName: 'yunxiao', transport: 'stdio', command: 'echo' },
      },
    ])
    expect(views.find((view) => view.name === 'yunxiao')?.conflict)
      .toContain('与已纳管服务器「yunxiao」同名')
    expect(views.find((view) => view.name === 'xterminal')?.conflict).toBeUndefined()
  })

  it('adopts hand-written rows into the block and keeps foreign rows', async () => {
    const { patchFile } = await stubProfile()
    await writeFile(patchFile, fixturePatch(), 'utf8')
    const server = installRoutes()

    const adopted = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/adopt`,
      body: {},
    })
    expect(adopted.status).toBe(200)
    const adoptedBody = adopted.json as {
      ok: boolean
      result: { adopted: string[]; skipped: Array<{ name: string; reason: string }> }
      state: McpManagerState
    }
    expect(adoptedBody.ok).toBe(true)
    expect(adoptedBody.result.adopted.sort()).toEqual(['xterminal', 'yunxiao'])
    expect(adoptedBody.result.skipped).toEqual([])
    expect(adoptedBody.state.servers.map((row) => row.name).sort())
      .toEqual(['github', 'xterminal', 'yunxiao'])
    expect(adoptedBody.state.unmanaged).toEqual([])

    const raw = await readFile(patchFile, 'utf8')
    // Exactly one managed block now; the adopted ids live inside it.
    expect(raw.indexOf(MCP_BLOCK_BEGIN)).toBe(raw.lastIndexOf(MCP_BLOCK_BEGIN))
    expect(raw).toContain('mcp-xterminal')
    expect(raw).toContain('mcp-yunxiao')
    // The foreign row sharing yunxiao's insert survived the cut.
    expect(raw).toContain('@example/other')

    const rows = await loadPatchRows()
    expect(rows.map((row) => row.config.serverName).sort())
      .toEqual(['github', 'xterminal', 'yunxiao'])
    // The folded Authorization scalar folds to a single space in the value.
    const xterminal = rows.find((row) => row.config.serverName === 'xterminal')
    expect(xterminal?.config.headers?.Authorization).toBe('Bearer folded token-line')
  })

  it('skips conflicting rows, leaves them in place, and reports the reason', async () => {
    const { patchFile } = await stubProfile()
    await writeFile(patchFile, fixturePatch(), 'utf8')
    await writePatchRows([
      {
        id: 'mcp-session-map-github',
        name: MCP_CLIENT_PACKAGE,
        config: { serverName: 'github', transport: 'stdio', command: 'npx' },
      },
      {
        id: 'mcp-session-map-yunxiao',
        name: MCP_CLIENT_PACKAGE,
        config: { serverName: 'yunxiao', transport: 'stdio', command: 'echo' },
      },
    ])
    const server = installRoutes()

    const adopted = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/adopt`,
      body: {},
    })
    expect(adopted.status).toBe(200)
    const adoptedBody = adopted.json as {
      ok: boolean
      result: { adopted: string[]; skipped: Array<{ name: string; reason: string }> }
      state: McpManagerState
    }
    expect(adoptedBody.result.adopted).toEqual(['xterminal'])
    expect(adoptedBody.result.skipped).toHaveLength(1)
    expect(adoptedBody.result.skipped[0]?.name).toBe('yunxiao')
    expect(adoptedBody.result.skipped[0]?.reason).toContain('同名')
    // The hand-written yunxiao row stayed outside the block (its id is exactly
    // mcp-yunxiao); the managed row inside the block keeps its own id.
    expect(adoptedBody.state.unmanaged).toHaveLength(1)
    expect(adoptedBody.state.unmanaged[0]?.conflict).toContain('同名')
    const raw = await readFile(patchFile, 'utf8')
    expect((raw.match(/id: mcp-yunxiao/g) ?? []).length).toBe(1)
    expect(raw).toContain('mcp-session-map-yunxiao')
  })

  it('adopts a !!js expression without corrupting it', async () => {
    const { patchFile } = await stubProfile()
    await writeFile(
      patchFile,
      [
        '- insert:',
        '    - id: mcp-js',
        `      name: "${MCP_CLIENT_PACKAGE}"`,
        '      config:',
        '        serverName: jsrow',
        '        transport: stdio',
        '        command: !!js process.env.MCP_CMD',
        '',
      ].join('\n'),
      'utf8',
    )
    const server = installRoutes()

    const adopted = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/adopt`,
      body: {},
    })
    expect(adopted.status).toBe(200)
    const raw = await readFile(patchFile, 'utf8')
    expect(raw).toContain('!!js process.env.MCP_CMD')
    const rows = await loadPatchRows()
    expect(rows[0]?.config.command).toEqual({ __js: 'process.env.MCP_CMD' })
  })

  it('adopts only requested names and reports unknown ones', async () => {
    const { patchFile } = await stubProfile()
    await writeFile(patchFile, fixturePatch(), 'utf8')
    const server = installRoutes()

    const adopted = await invokeRoute(server, {
      method: 'POST',
      path: `${MCP_MANAGER_ROUTE}/adopt`,
      body: { names: ['xterminal', 'ghost'] },
    })
    expect(adopted.status).toBe(200)
    const adoptedBody = adopted.json as {
      ok: boolean
      result: { adopted: string[]; skipped: Array<{ name: string; reason: string }> }
    }
    expect(adoptedBody.result.adopted).toEqual(['xterminal'])
    expect(adoptedBody.result.skipped).toEqual([
      { name: 'ghost', id: '', reason: '管理块之外没有这台服务器' },
    ])
    // yunxiao was not requested, so it stays untouched and unreported.
    const raw = await readFile(patchFile, 'utf8')
    expect(raw).toContain('id: mcp-yunxiao')
    expect(await loadPatchRows()).toHaveLength(2)
  })

  it('surfaces unmanaged rows through the state route', async () => {
    const { patchFile } = await stubProfile()
    await writeFile(patchFile, fixturePatch(), 'utf8')
    const server = installRoutes()

    const state = await invokeRoute(server, { path: `${MCP_MANAGER_ROUTE}/state` })
    expect(state.status).toBe(200)
    const stateBody = state.json as { ok: boolean; state: McpManagerState }
    expect(stateBody.ok).toBe(true)
    expect(stateBody.state.unmanaged.map((row) => row.name)).toEqual(['xterminal', 'yunxiao'])
    expect(stateBody.state.unmanaged[0]?.endpoint).toBe('http://127.0.0.1:12335/mcp')
    expect(stateBody.state.unmanaged[0]?.conflict).toBeUndefined()
  })
})
