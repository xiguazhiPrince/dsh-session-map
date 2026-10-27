/**
 * Architecture guards for the safety-critical Git code.
 *
 * These tests scan the production sources instead of calling them: they fail if
 * someone later introduces a shell, spawns git outside the subprocess seam, or
 * wires a write action around the confirmation/queue path.
 *
 * @module dsh-session-map/git-workspace/safety.architecture.test
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Production source tree the guards scan. */
const ROOT = join(process.cwd(), 'src', 'git-workspace')

/** Read every production `.ts` file under the feature directory. */
async function productionSources(): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'testing') continue
        await walk(path)
        continue
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
      files.set(relative(ROOT, path).replace(/\\/g, '/'), await readFile(path, 'utf8'))
    }
  }
  await walk(ROOT)
  return files
}

describe('git workspace architecture', () => {
  it('never imports a shell or spawns a process outside the subprocess seam', async () => {
    const sources = await productionSources()
    expect(sources.size).toBeGreaterThan(5)
    for (const [path, text] of sources) {
      expect(text, `${path} must not import child_process`).not.toMatch(/from ['"]node:child_process['"]/)
      expect(text, `${path} must not call exec/execFile`).not.toMatch(/(?<![.\w])exec(?:File)?\s*\(/)
      expect(text, `${path} must not request a shell`).not.toMatch(/shell:\s*true/)
    }
  })

  it('routes every write action through the action router', async () => {
    const sources = await productionSources()
    const hostGit = sources.get('host-git.ts') ?? ''
    expect(hostGit).toContain('createActionRouter')
    expect(hostGit).toMatch(/path === '\/confirm' \|\| path === '\/action'/)
    const actions = sources.get('host-actions.ts') ?? ''
    expect(actions).toContain('consume(')
    expect(actions).toContain('confirmation-required')
    expect(actions).toContain('running.has(repo.root)')
  })

  it('keeps destructive flags out of the write builders', async () => {
    const sources = await productionSources()
    const command = sources.get('git-actions.ts') ?? ''
    expect(command).not.toContain("'--force'")
    expect(command).not.toContain("'--no-verify'")
    expect(command).not.toContain("'-x'")
    expect(command).toContain("'clean', '-nd'")
    expect(command).toContain("'clean', '-fd'")
  })

  it('keeps the clone rules independent from the tool window modules', async () => {
    const sources = await productionSources()
    const clone = sources.get('git.ts') ?? ''
    expect(clone).not.toContain('git-actions')
    expect(clone).not.toContain('host-actions')
  })
})
