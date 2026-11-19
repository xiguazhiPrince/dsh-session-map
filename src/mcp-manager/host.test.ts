/**
 * Host tests for the MCP manager: patch I/O under a temp profile, and the
 * `/plugin-mcp-manager` route envelopes over the production trust gate.
 *
 * @module dsh-session-map/mcp-manager/host.test
 */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeContext,
  FakeWebServer,
  invokeRoute,
} from '../git-workspace/testing/fake-host'
import {
  buildManagerState,
  clearOAuthFlows,
  clearProbeCache,
  installMcpManagerHost,
  loadPatchRows,
  resolvePatchFile,
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
