/**
 * Log-reader tests: multi-frame Zstandard logs (the reason the reader walks
 * frames itself), torn tails, plaintext logs, and per-directory version choice.
 *
 * @module dsh-session-map/usage-stats/scan.test
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { listSessionLogs, pickLogName, scanZstdFrames, summarizeLogFile } from './scan'

/** Temporary directories created by one test. */
const created: string[] = []

/** Create a temporary directory and remember it for cleanup. */
async function makeTemp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-scan-'))
  created.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(async root => await rm(root, { recursive: true, force: true })))
})

const T0 = Date.UTC(2026, 10, 14, 4)

/** JSONL batch text. */
function batch(...records: readonly unknown[]): string {
  return records.map(record => `${JSON.stringify(record)}\n`).join('')
}

/** The three batches of one small Session. */
const BATCHES = [
  batch({ type: 'session', version: 4, id: 's1', createdAt: T0, cwd: '/w/p', isSeeded: false }),
  batch(
    { type: 'turn/start', seq: 0, time: T0, data: { turn: 1 } },
    { type: 'tool/call', seq: 1, time: T0, data: { callId: 'c', name: 'edit', arguments: '{"file_path":"/w/p/a.ts"}' } },
  ),
  batch(
    { type: 'tool/result', seq: 2, time: T0, data: { message: { toolCallId: 'c', isError: false }, meta: { diffs: [{ path: '/w/p/a.ts', oldText: '', newText: 'x\ny\n' }] } } },
    { type: 'turn/end', seq: 3, time: T0 + 500, data: { turn: 1, reason: { kind: 'completed' } } },
  ),
]

/** One frame per batch, like the backend's appends. */
function multiFrame(batches: readonly string[]): Buffer {
  return Buffer.concat(batches.map(text => zstdCompressSync(Buffer.from(text))))
}

describe('scanZstdFrames', () => {
  it('finds every frame of a concatenated stream', () => {
    const bytes = multiFrame(BATCHES)
    // The one-shot decoder stops after the first frame — the bug this avoids.
    expect(zstdDecompressSync(bytes).toString()).toBe(BATCHES[0])
    const { frames, torn } = scanZstdFrames(bytes)
    expect(torn).toBe(false)
    expect(frames.map(frame => zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString())).toEqual(BATCHES)
  })

  it('leaves out a torn final frame', () => {
    const bytes = multiFrame(BATCHES)
    const { frames, torn } = scanZstdFrames(bytes.subarray(0, bytes.length - 3))
    expect(torn).toBe(true)
    expect(frames).toHaveLength(2)
  })

  it('rejects bytes that are not Zstandard', () => {
    expect(() => scanZstdFrames(Buffer.from('{"type":"session"}\n'))).toThrow('Zstandard')
  })
})

describe('summarizeLogFile', () => {
  it('folds compressed and plaintext logs the same way', async () => {
    const root = await makeTemp()
    const compressed = join(root, 'session.v4.jsonl.zstd')
    const plain = join(root, 'session.v4.jsonl')
    await writeFile(compressed, multiFrame(BATCHES))
    await writeFile(plain, BATCHES.join(''))
    for (const path of [compressed, plain]) {
      const result = await summarizeLogFile(path)
      if (!result.ok) throw new Error(result.reason)
      const buckets = Object.values(result.summary.buckets)
      expect(buckets.reduce((sum, bucket) => sum + bucket.added, 0)).toBe(2)
      expect(buckets.reduce((sum, bucket) => sum + bucket.activeMs, 0)).toBe(500)
    }
  })
})

describe('summarizeLogFile across frames', () => {
  it('keeps a multi-byte character split between two frames', async () => {
    const root = await makeTemp()
    const path = join(root, 'session.v4.jsonl.zstd')
    const text = batch(
      { type: 'session', version: 4, id: 's1', createdAt: T0, cwd: '/w/项目', isSeeded: false },
      { type: 'assistant/message', seq: 0, time: T0, data: { message: { role: 'assistant', source: { model: '模型' } } } },
    )
    const bytes = Buffer.from(text)
    // Cut inside the three-byte encoding of 项.
    const cut = bytes.indexOf(Buffer.from('项')) + 1
    await writeFile(path, Buffer.concat([zstdCompressSync(bytes.subarray(0, cut)), zstdCompressSync(bytes.subarray(cut))]))
    const result = await summarizeLogFile(path)
    if (!result.ok) throw new Error(result.reason)
    expect(result.summary.cwd).toBe('/w/项目')
  })
})

describe('pickLogName and listSessionLogs', () => {
  it('prefers the newest format version, then the compressed file', () => {
    expect(pickLogName(['session.v3.jsonl.zstd', 'session.v4.jsonl.zstd', 'notes.txt'])).toBe('session.v4.jsonl.zstd')
    expect(pickLogName(['session.jsonl.zstd', 'session.v3.jsonl'])).toBe('session.v3.jsonl')
    expect(pickLogName(['session.v4.jsonl', 'session.v4.jsonl.zstd'])).toBe('session.v4.jsonl.zstd')
    expect(pickLogName(['session.v4.jsonl.zstd.tmp'])).toBeUndefined()
  })

  it('lists one log per Session directory', async () => {
    const root = await makeTemp()
    await mkdir(join(root, '--w-p', 's1'), { recursive: true })
    await mkdir(join(root, '--w-p', 's2'), { recursive: true })
    await mkdir(join(root, '--w-p', 'empty'), { recursive: true })
    await writeFile(join(root, '--w-p', 's1', 'session.v3.jsonl.zstd'), 'old')
    await writeFile(join(root, '--w-p', 's1', 'session.v4.jsonl.zstd'), 'new')
    await writeFile(join(root, '--w-p', 's2', 'session.jsonl'), 'x')
    const files = await listSessionLogs(root)
    expect(files.map(file => file.rel)).toEqual([
      join('--w-p', 's1', 'session.v4.jsonl.zstd'),
      join('--w-p', 's2', 'session.jsonl'),
    ])
    expect(await listSessionLogs(join(root, 'missing'))).toEqual([])
  })
})
