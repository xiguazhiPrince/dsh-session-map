/**
 * Pure tests for the MCP manager wire vocabulary.
 *
 * @module dsh-session-map/mcp-manager/model.test
 */
import { describe, expect, it } from 'vitest'
import {
  adoptFromEnvelope,
  buildExportText,
  buildPatchRow,
  formatParameterSummary,
  maskSecretMap,
  normalizeServerInput,
  parseImportText,
  sortServers,
  summariseParameters,
  viewFromPatchRow,
  type McpAdoptEnvelope,
  type McpServerView,
} from './model'

describe('normalizeServerInput', () => {
  it('accepts a stdio server', () => {
    const input = normalizeServerInput({
      name: 'github',
      transport: 'stdio',
      enabled: true,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: '$GITHUB_TOKEN' },
    })
    expect(input.transport).toBe('stdio')
    expect(input.command).toBe('npx')
    expect(input.args).toEqual(['-y', '@modelcontextprotocol/server-github'])
  })

  it('rejects a bad serverName', () => {
    expect(() => normalizeServerInput({ name: 'bad name', transport: 'stdio', command: 'x' }))
      .toThrow(/1–32/)
  })

  it('requires an http(s) url for http transport', () => {
    expect(() => normalizeServerInput({ name: 'docs', transport: 'http', url: 'example.com' }))
      .toThrow(/http/)
  })
})

describe('buildPatchRow / viewFromPatchRow', () => {
  it('round-trips a stdio row', () => {
    const input = normalizeServerInput({
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'pkg'],
      enabled: true,
    })
    const row = buildPatchRow(input)
    expect(row.id).toBe('mcp-session-map-github')
    expect(row.name).toBe('@deepseek-ai/dsh-mcp-client')
    expect(row.config.transport).toBe('stdio')
    const view = viewFromPatchRow(row)
    expect(view.name).toBe('github')
    expect(view.transport).toBe('stdio')
    expect(view.enabled).toBe(true)
  })

  it('marks disabled rows as off', () => {
    const row = buildPatchRow(normalizeServerInput({
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
      enabled: false,
    }))
    expect(row.disabled).toBe(true)
    expect(viewFromPatchRow(row).state).toBe('off')
  })
})

describe('parseImportText / buildExportText', () => {
  it('imports a Claude mcpServers object', () => {
    const text = JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        },
        docs: {
          url: 'https://mcp.example.com/docs',
        },
      },
    })
    const inputs = parseImportText(text)
    expect(inputs).toHaveLength(2)
    expect(inputs.find((item) => item.name === 'docs')?.transport).toBe('http')
  })

  it('exports servers as mcpServers JSON', () => {
    const servers: McpServerView[] = [
      {
        id: 'mcp-session-map-github',
        name: 'github',
        transport: 'stdio',
        enabled: true,
        state: 'online',
        message: '',
        tools: 2,
        live: true,
        oauth: false,
        command: 'npx',
        args: ['-y', 'pkg'],
        env: {},
        cwd: '',
        url: '',
        headers: {},
        timeoutMs: 60_000,
        reconnectEnabled: true,
      },
    ]
    const text = buildExportText(servers)
    const parsed = JSON.parse(text) as { mcpServers: Record<string, { command: string }> }
    expect(parsed.mcpServers.github?.command).toBe('npx')
  })
})

describe('maskSecretMap / sortServers', () => {
  it('masks authorization-like keys', () => {
    expect(maskSecretMap({ Authorization: 'Bearer x', Accept: 'json' })).toEqual({
      Authorization: '••••••••',
      Accept: 'json',
    })
  })

  it('sorts by name', () => {
    const sorted = sortServers([
      { name: 'web' } as McpServerView,
      { name: 'github' } as McpServerView,
    ])
    expect(sorted.map((item) => item.name)).toEqual(['github', 'web'])
  })
})

describe('adoptFromEnvelope', () => {
  it('unwraps the adopt result', () => {
    const body = {
      ok: true,
      result: { adopted: ['xterminal', 'yunxiao'], skipped: [] },
    } as McpAdoptEnvelope
    expect(adoptFromEnvelope(body).adopted).toEqual(['xterminal', 'yunxiao'])
  })

  it('throws the host message on failure', () => {
    expect(() => adoptFromEnvelope({
      ok: false,
      error: { code: 'patch-error', message: '写入 profile patch 失败：disk' },
    })).toThrow('写入 profile patch 失败：disk')
  })
})

describe('summariseParameters / formatParameterSummary', () => {
  it('formats required and optional properties', () => {
    const schema = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        session: { type: 'string' },
        lines: { type: 'array', items: { type: 'number' } },
      },
      required: ['path'],
    }
    expect(summariseParameters(schema)).toEqual([
      { name: 'path', type: 'string', required: true },
      { name: 'session', type: 'string', required: false },
      { name: 'lines', type: 'number[]', required: false },
    ])
    expect(formatParameterSummary(schema)).toBe('path: string · session?: string · lines?: number[]')
  })
})
