/**
 * Per-tool permission policy for MCP tool namespaces.
 *
 * The policy is what the Conversation → MCP tab edits and what the Host-side
 * gate enforces. It lives in its own JSON file inside the profile directory
 * rather than in `cordis.patch.yml`, because the patch file is a Loader entry
 * array — policy is data, not a plugin row.
 *
 * Three answers exist per tool: `allow` (visible, callable), `ask` (visible,
 * every call waits for one approval) and `deny` (invisible, and a call is
 * refused even if it arrives). A server's `fallback` covers every tool the
 * file does not name, so a tool the server adds later is denied until someone
 * names it.
 *
 * This module is Host-only (it touches the filesystem). The shared vocabulary
 * — {@link ToolPermission} — lives in `./model` because the browser bundle
 * imports that too.
 *
 * @module dsh-session-map/mcp-manager/policy
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isObject, type ToolPermission } from './model'

/** File name, next to `cordis.patch.yml` in the profile directory. */
export const POLICY_FILE_NAME = 'mcp-tool-policy.json'

/** Current on-disk schema version. */
export const POLICY_VERSION = 1

/** One server's policy. */
export interface ServerPolicy {
  /** Permission for every tool this policy does not name. */
  readonly fallback: ToolPermission
  /** Explicit answers keyed by raw tool name (without the `mcp__ns__` prefix). */
  readonly tools: Readonly<Record<string, ToolPermission>>
}

/** The complete policy document. */
export interface PolicyFile {
  readonly version: number
  /** Server policies keyed by serverName. A server with no entry is not gated. */
  readonly servers: Readonly<Record<string, ServerPolicy>>
}

/** Empty policy: no server is gated, every MCP tool stays as it was. */
export const EMPTY_POLICY: PolicyFile = { version: POLICY_VERSION, servers: {} }

/** Whether a value is one of the three permissions. */
export function isPermission(value: unknown): value is ToolPermission {
  return value === 'allow' || value === 'ask' || value === 'deny'
}

/**
 * Read one server's policy as a comparable, JSON-serialisable value.
 * @param text - raw file text.
 * @returns the normalised document; malformed input degrades to empty.
 */
export function parsePolicy(text: string): PolicyFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return EMPTY_POLICY
  }
  if (!isObject(parsed)) return EMPTY_POLICY
  const serversIn = isObject(parsed.servers) ? parsed.servers : {}
  const servers: Record<string, ServerPolicy> = {}
  for (const [name, raw] of Object.entries(serversIn)) {
    if (!isObject(raw)) continue
    const fallback = isPermission(raw.fallback) ? raw.fallback : 'deny'
    const tools: Record<string, ToolPermission> = {}
    if (isObject(raw.tools)) {
      for (const [tool, value] of Object.entries(raw.tools)) {
        if (isPermission(value)) tools[tool] = value
      }
    }
    servers[name] = { fallback, tools }
  }
  return { version: POLICY_VERSION, servers }
}

/** Absolute path of the policy file for one profile directory. */
export function policyPath(profileDir: string): string {
  return join(profileDir, POLICY_FILE_NAME)
}

/**
 * Load the policy for one profile directory.
 * @param profileDir - profile directory holding `cordis.patch.yml`.
 */
export async function readPolicy(profileDir: string): Promise<PolicyFile> {
  try {
    return parsePolicy(await readFile(policyPath(profileDir), 'utf8'))
  } catch {
    return EMPTY_POLICY
  }
}

/**
 * Replace the policy file atomically (write a sibling, then rename).
 * @param profileDir - profile directory.
 * @param value - full document to persist.
 */
export async function writePolicy(profileDir: string, value: PolicyFile): Promise<void> {
  const target = policyPath(profileDir)
  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, target)
}

/**
 * Apply one edit to a server's policy and return the document that was saved.
 * @param profileDir - profile directory.
 * @param server - serverName to edit.
 * @param mutate - receives the current server policy, returns the next one.
 */
export async function updateServerPolicy(
  profileDir: string,
  server: string,
  mutate: (current: ServerPolicy) => ServerPolicy,
): Promise<PolicyFile> {
  const current = await readPolicy(profileDir)
  // A server that had no policy starts open: touching one tool must never
  // silently hide the other twenty-nine. Locking a server down is an explicit
  // "全部禁止", which writes the deny fallback and clears this default.
  const previous = current.servers[server] ?? { fallback: 'allow' as const, tools: {} }
  const next: PolicyFile = {
    version: POLICY_VERSION,
    servers: { ...current.servers, [server]: mutate(previous) },
  }
  await writePolicy(profileDir, next)
  return next
}

/**
 * The permission that decides one tool right now.
 * @param policy - document to read.
 * @param server - serverName the tool belongs to.
 * @param tool - raw tool name.
 * @returns the explicit answer, else the server fallback, else `undefined`
 *   when the server is not gated at all.
 */
export function permissionOf(
  policy: PolicyFile,
  server: string,
  tool: string,
): ToolPermission | undefined {
  const entry = policy.servers[server]
  if (entry === undefined) return undefined
  return entry.tools[tool] ?? entry.fallback
}

/**
 * Count one server's tools by answer, for the list row and the filter chips.
 * @param tools - tool names the Host currently knows for that server.
 * @param entry - that server's policy, when it has one.
 */
export function summarize(
  tools: readonly string[],
  entry: ServerPolicy | undefined,
): { allow: number; ask: number; deny: number; unnamed: number } {
  const out = { allow: 0, ask: 0, deny: 0, unnamed: 0 }
  if (entry === undefined) return out
  for (const tool of tools) {
    const named = entry.tools[tool]
    if (named === undefined) out.unnamed += 1
    else out[named] += 1
  }
  return out
}
