/**
 * Registration tests for the Git right-column page.
 *
 * The right-column registry is a service another package provides, so the test
 * drives the deferred `ctx.inject` path explicitly: this is the cold-boot race
 * that once left the tab type unregistered (a header button opening a kind
 * nothing had registered). It also pins the "same id reuses, different id
 * throws" claim rule.
 *
 * @module dsh-session-map/git-workspace/window/rightbar/install.test
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type {
  SidebarRightTabDefinition,
  SidebarRightTabsService,
  SlotRegistrationOptions,
  SlotsService,
} from '../../../session-map/sidebar-right'
import { installGitRightbarPage } from './install'
import { GIT_RIGHTBAR_HEADER_ID, GIT_RIGHTBAR_KIND, GIT_RIGHTBAR_TYPE_ID } from './ids'

/** One registration the fake slot registry received. */
interface SlotRegistration {
  readonly options: SlotRegistrationOptions
  readonly component: unknown
}

/** A fake browser context plus the registries it hands out. */
function createFakeContext(): {
  readonly ctx: Context
  readonly services: Map<string, unknown>
  readonly slotKeys: string[]
  readonly registrations: SlotRegistration[]
  readonly types: SidebarRightTabDefinition[]
  readonly effects: string[]
  readonly injects: Array<{ readonly deps: readonly string[]; readonly callback: (scope: Context) => void }>
  readonly registerTabs: () => void
} {
  const services = new Map<string, unknown>()
  const slotKeys: string[] = []
  const registrations: SlotRegistration[] = []
  const types: SidebarRightTabDefinition[] = []
  const effects: string[] = []
  const injects: Array<{ deps: readonly string[]; callback: (scope: Context) => void }> = []

  const slots: SlotsService = {
    inject(key, callback) {
      slotKeys.push(key)
      return callback()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => undefined
    },
  }

  const tabs: SidebarRightTabsService = {
    get(kind) {
      return types.find(type => type.kind === kind)
    },
    register(definition) {
      types.push(definition)
      return () => undefined
    },
  }

  services.set('slots', slots)

  const scope = {
    get: (name: string) => services.get(name),
    effect: (body: () => () => void, label?: string) => {
      effects.push(label ?? '')
      return body()
    },
  } as unknown as Context

  const ctx = {
    get: (name: string) => services.get(name),
    effect: (body: () => () => void, label?: string) => {
      effects.push(label ?? '')
      return body()
    },
    inject: (deps: readonly string[], callback: (inner: Context) => void) => {
      injects.push({ deps, callback })
    },
    /** The deferred injection body, run with the fake scope. */
    _runInjections: () => {
      for (const injection of injects) injection.callback(scope)
    },
  } as unknown as Context

  return {
    ctx,
    services,
    slotKeys,
    registrations,
    types,
    effects,
    injects,
    /** Publish the tab-type registry, then run the deferred inject bodies. */
    registerTabs: () => {
      services.set('sidebarRightTabs', tabs)
      for (const injection of injects) injection.callback(scope)
    },
  }
}

describe('installGitRightbarPage', () => {
  it('registers the body and the header launcher without the right-column service', () => {
    const fake = createFakeContext()
    installGitRightbarPage(fake.ctx)

    expect(fake.slotKeys).toContain('sidebar.right.pane.tab')
    expect(fake.registrations).toContainEqual(expect.objectContaining({
      options: expect.objectContaining({ name: 'sidebar.right.pane.tab', key: GIT_RIGHTBAR_TYPE_ID }),
    }))
    expect(fake.registrations.some(registration => registration.options.id === GIT_RIGHTBAR_HEADER_ID)).toBe(true)
    expect(fake.registrations.some(registration => registration.options.order === 41)).toBe(true)
    // Nothing claimed the type yet: the registry was absent.
    expect(fake.types).toHaveLength(0)
    expect(fake.effects).toContain('git-window: rightbar tab body')
  })

  it('claims the tab type once the registry is provided', () => {
    const fake = createFakeContext()
    installGitRightbarPage(fake.ctx)
    fake.registerTabs()

    expect(fake.types).toHaveLength(1)
    const definition = fake.types[0]
    expect(definition?.id).toBe(GIT_RIGHTBAR_TYPE_ID)
    expect(definition?.kind).toBe(GIT_RIGHTBAR_KIND)
    expect(definition?.title('')).toBe('Git')
    expect(definition?.guide?.[0]?.title()).toBe('Git')
  })

  it('reuses a lingering same-id type and rejects a different type on the same kind', () => {
    const fake = createFakeContext()
    installGitRightbarPage(fake.ctx)
    fake.registerTabs()
    expect(fake.types).toHaveLength(1)

    // A previous incarnation already holds the same type: claiming it again is
    // safe because the bodies were re-registered under the new fiber.
    installGitRightbarPage(fake.ctx)
    fake.registerTabs()
    expect(fake.types).toHaveLength(1)

    // A different package holding the kind is a wiring conflict.
    fake.types[0] = { id: 'other-package.git', kind: GIT_RIGHTBAR_KIND, title: () => 'Other' }
    expect(() => {
      installGitRightbarPage(fake.ctx)
      fake.registerTabs()
    }).toThrow(/already held by tab type "other-package.git"/)
  })
})
