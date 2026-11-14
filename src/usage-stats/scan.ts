/**
 * Session log reader for the usage statistics Host half.
 *
 * DSH's JSONL backend stores one Session per directory,
 * `<root>/<cwd-slug>/<session-id>/session[.vN].jsonl[.zstd]`. A compressed log
 * is a concatenation of independent Zstandard frames — one per appended batch —
 * and Node's one-shot `zstdDecompressSync` stops after the first frame, so this
 * module walks the frame structure itself (the same structural scan the backend
 * uses) and decodes frame by frame. An incomplete final frame belongs to a
 * batch still being written; it is left for the next scan, whose changed size
 * and mtime will select the file again.
 *
 * Decoding is synchronous per frame (the largest observed frame takes under
 * 100 ms) and the reader yields to the event loop between time slices, which
 * measured ~40% faster than the thread-pool `zstdDecompress` because 120k small
 * frames otherwise pay one pool round trip each.
 *
 * @module dsh-session-map/usage-stats/scan
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { SessionSummarizer, type SummarizeResult } from './model'

/** Zstandard frame magic, little-endian. */
const ZSTD_MAGIC = 0xFD2FB528

/** Skippable-frame magic range, little-endian (0x184D2A50–0x184D2A5F). */
const SKIPPABLE_MASK = 0xFFFFFFF0
const SKIPPABLE_MAGIC = 0x184D2A50

/** Longest stretch of synchronous work before yielding to the event loop. */
const SLICE_MS = 12

/** One complete frame's byte range. */
export interface FrameRange {
  readonly start: number
  readonly end: number
}

/**
 * Locate the complete Zstandard frames of a concatenated stream without
 * decoding their blocks. Scanning stops at an incomplete final frame.
 * @param buffer - file bytes.
 * @returns complete frames in order, and whether a torn tail was left out.
 * @throws when a complete frame header is not Zstandard at all.
 */
export function scanZstdFrames(buffer: Uint8Array): { frames: FrameRange[]; torn: boolean } {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 8) return { frames, torn: true }
    const magic = view.getUint32(offset, true)
    if ((magic & SKIPPABLE_MASK) >>> 0 === SKIPPABLE_MAGIC) {
      const size = view.getUint32(offset + 4, true)
      if (buffer.length - offset - 8 < size) return { frames, torn: true }
      offset += 8 + size
      continue
    }
    if (magic !== ZSTD_MAGIC) throw new Error(`不是 Zstandard 帧（偏移 ${String(offset)}）`)
    offset += 4
    const descriptor = buffer[offset] ?? 0
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, torn: true }
      const blockHeader = (buffer[offset] ?? 0) | ((buffer[offset + 1] ?? 0) << 8) | ((buffer[offset + 2] ?? 0) << 16)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`Zstandard 块类型无效（偏移 ${String(offset - 3)}）`)
      offset += blockType === 1 ? 1 : blockSize
      if (offset > buffer.length) return { frames, torn: true }
      if (lastBlock) break
    }
    if (checksum) offset += 4
    if (offset > buffer.length) return { frames, torn: true }
    frames.push({ start, end: offset })
  }
  return { frames, torn: false }
}

/** Cooperative time slicing for synchronous loops. */
export class Slicer {
  private sliceStart = Date.now()

  /** @param signal - aborts the surrounding scan. */
  constructor(private readonly signal?: AbortSignal) {}

  /** Yield to the event loop when the current slice is used up. */
  async maybeYield(): Promise<void> {
    this.signal?.throwIfAborted()
    if (Date.now() - this.sliceStart < SLICE_MS) return
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    this.sliceStart = Date.now()
    this.signal?.throwIfAborted()
  }
}

/**
 * Feed every line of one decoded chunk sequence to a sink. Lines may span
 * chunk boundaries; the remainder is carried.
 */
class LineSplitter {
  private carry = ''

  constructor(private readonly sink: (line: string) => void) {}

  push(text: string): void {
    const joined = this.carry + text
    let from = 0
    for (let newline = joined.indexOf('\n'); newline !== -1; newline = joined.indexOf('\n', from)) {
      this.sink(joined.slice(from, newline))
      from = newline + 1
    }
    this.carry = joined.slice(from)
  }

  end(): void {
    if (this.carry !== '') this.sink(this.carry)
    this.carry = ''
  }
}

/**
 * Fold one Session log file.
 * @param path - absolute log path.
 * @param slicer - shared time slicer of the scan.
 * @returns the summary, or why the log cannot be counted.
 */
export async function summarizeLogFile(path: string, slicer: Slicer = new Slicer()): Promise<SummarizeResult> {
  const bytes = await readFile(path)
  const summarizer = new SessionSummarizer()
  const lines = new LineSplitter((line) => { summarizer.pushLine(line) })
  const decoder = new TextDecoder()
  if (path.endsWith('.zstd')) {
    const { frames } = scanZstdFrames(bytes)
    for (const frame of frames) {
      await slicer.maybeYield()
      // Streaming decode: a frame boundary may split a multi-byte character.
      lines.push(decoder.decode(zstdDecompressSync(bytes.subarray(frame.start, frame.end)), { stream: true }))
    }
    lines.push(decoder.decode())
  } else {
    // A plaintext log may end mid-line while a batch is being appended; the
    // partial line fails to parse and is ignored like a torn frame.
    const text = decoder.decode(bytes)
    for (let from = 0; from < text.length;) {
      await slicer.maybeYield()
      const to = Math.min(text.length, from + 1_000_000)
      lines.push(text.slice(from, to))
      from = to
    }
  }
  lines.end()
  return summarizer.finish()
}

/** One Session log selected for counting. */
export interface LogFile {
  /** Absolute path. */
  readonly path: string
  /** Path relative to the Sessions root; the cache key. */
  readonly rel: string
  readonly size: number
  readonly mtimeMs: number
}

/** Canonical log file name: `session.jsonl[.zstd]` or `session.vN.jsonl[.zstd]`. */
const LOG_NAME = /^session(?:\.v([1-9]\d*))?\.jsonl(\.zstd)?$/

/**
 * Pick the log to count in one Session directory: the newest format version.
 * A format migration copies the old generation into a new one and may leave
 * the old file behind, so counting both would count the Session twice.
 * @param names - entries of the Session directory.
 * @returns the chosen file name, or undefined when there is no log.
 */
export function pickLogName(names: readonly string[]): string | undefined {
  let best: { name: string; version: number; zstd: boolean } | undefined
  for (const name of names) {
    const match = LOG_NAME.exec(name)
    if (match === null) continue
    const version = match[1] === undefined ? 0 : Number(match[1])
    const zstd = match[2] !== undefined
    if (best === undefined || version > best.version || (version === best.version && zstd && !best.zstd)) {
      best = { name, version, zstd }
    }
  }
  return best?.name
}

/** Directory entries, or none when the directory cannot be read. */
async function listDir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }))
  } catch {
    return []
  }
}

/**
 * List the log to count for every Session under the root.
 * @param root - the Sessions root, `$DSH_HOME/sessions`.
 * @param signal - aborts the listing.
 * @returns one file per Session directory, sorted by relative path.
 */
export async function listSessionLogs(root: string, signal?: AbortSignal): Promise<LogFile[]> {
  const files: LogFile[] = []
  for (const project of await listDir(root)) {
    if (!project.isDirectory) continue
    const projectPath = join(root, project.name)
    for (const session of await listDir(projectPath)) {
      signal?.throwIfAborted()
      if (!session.isDirectory) continue
      const sessionPath = join(projectPath, session.name)
      const name = pickLogName((await listDir(sessionPath)).filter(entry => !entry.isDirectory).map(entry => entry.name))
      if (name === undefined) continue
      const path = join(sessionPath, name)
      try {
        const info = await stat(path)
        files.push({ path, rel: relative(root, path), size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        // Deleted between listing and stat.
      }
    }
  }
  return files.sort((left, right) => (left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0))
}
