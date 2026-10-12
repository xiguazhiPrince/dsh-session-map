#!/usr/bin/env node
/**
 * Opt-in live smoke test: drive a REAL ACP agent through the same driver the
 * plugin registers, with no DSH involved. Any CLI that speaks ACP on stdio
 * works; the default is Cursor.
 *
 * Not part of `pnpm test` — it needs an installed, authenticated CLI and it
 * spends real quota.
 *
 *   node test/live-acp.mjs "reply with exactly: pong"
 *   node test/live-acp.mjs --command opencode "reply with exactly: pong"
 *   node test/live-acp.mjs --edit
 *   node test/live-acp.mjs --command opencode --config-option model=opencode-go/deepseek-v4-flash "say hi"
 *
 * `--edit` is the decision probe for the "advertise no client capabilities"
 * choice: it asks the agent to create a file in a throwaway directory and then
 * checks the file on disk. If an agent cannot act without a client-provided
 * filesystem capability, that probe fails and the driver must implement
 * `fs/read_text_file` and `fs/write_text_file` for real.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost, startRequest } from './support/harness.mjs'

const { apply } = await import('../lib/acp.js')

const args = process.argv.slice(2)
const editProbe = args.includes('--edit')
let command = 'cursor-agent'
let mode
let permission = 'allow'
const cliArgs = []
const configOptions = {}
const words = []
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--edit') continue
  if (arg === '--command') { command = args[index += 1]; continue }
  if (arg === '--arg') { cliArgs.push(args[index += 1]); continue }
  if (arg === '--mode') { mode = args[index += 1]; continue }
  if (arg === '--permission') { permission = args[index += 1]; continue }
  if (arg === '--config-option') {
    const [id, ...rest] = String(args[index += 1]).split('=')
    configOptions[id] = rest.join('=')
    continue
  }
  words.push(arg)
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-acp-live-'))
const marker = 'dsh-acp-live-probe.txt'
const prompt = editProbe
  ? `Create a file named ${marker} in your working directory whose exact contents are "OK". Do nothing else.`
  : (words.join(' ') === '' ? 'reply with exactly: pong' : words.join(' '))

const host = createHost()
apply(host.ctx, {
  providerName: 'live',
  command,
  args: cliArgs.length > 0 ? cliArgs : ['acp'],
  ...(mode === undefined ? {} : { mode }),
  ...(Object.keys(configOptions).length === 0 ? {} : { configOptions }),
  permission,
  disposeEofGraceMs: 15000,
})

const provider = host.provider()
console.log(`provider: ${provider.name}`)
console.log(`command : ${command} ${(cliArgs.length > 0 ? cliArgs : ['acp']).join(' ')}`)
console.log(`cwd     : ${dir}`)
console.log(`prompt  : ${prompt}`)
const started = Date.now()
const run = await provider.start(startRequest(dir, prompt))
const result = await run.result
console.log(`stop    : ${result.stopReason} (${Date.now() - started} ms)`)
if (result.diagnostic !== undefined) console.log(`diag    : ${result.diagnostic}`)
console.log(`output  : ${result.output.map(block => block.text).join('').trim()}`)
await run.dispose()
console.log('disposed: child at quiescence')

if (editProbe) {
  const target = join(dir, marker)
  let contents
  try {
    contents = readFileSync(target, 'utf8')
  } catch {
    console.error(`\nEDIT PROBE FAILED: the agent did not create ${target}`)
    process.exit(1)
  }
  if (contents.trim() !== 'OK') {
    console.error(`\nEDIT PROBE FAILED: unexpected contents ${JSON.stringify(contents)}`)
    process.exit(1)
  }
  console.log('\nEDIT PROBE PASSED: the agent wrote the file with no client filesystem capability advertised')
}
