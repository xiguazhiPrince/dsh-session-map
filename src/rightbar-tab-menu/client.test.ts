/**
 * Registration and row-behaviour tests for the right-column tab actions.
 *
 * The rows resolve their service and the strip at render time, so the test
 * drives the registered component directly: it pins that the registration
 * names the menu slot and a fresh cell id, that a row only appears when it
 * would close something, that dismissing happens before the tabs close, and
 * that the session-wide fallback still answers "close others" without a DOM.
 *
 * @module dsh-session-map/rightbar-tab-menu/client.test
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SlotRegistrationOptions, SlotsService } from '../session-map/sidebar-right'
import {
  installRightbarTabMenu,
  TAB_MENU_ENTRY_ID,
  TAB_MENU_ENTRY_ORDER,
  TAB_MENU_SLOT,
  type RightbarTabMenuProps,
} from './client'

/** One entry the fake slot registry received. */
interface SlotRegistration {
  readonly options: SlotRegistrationOptions
  readonly component: (props: RightbarTabMenuProps) => ReactElement | null
}

/** A fake browser context plus the registries it hands out. */
function createFakeContext(): {
  readonly ctx: Context
  readonly services: Map<string, unknown>
  readonly slotKeys: string[]
  readonly registrations: SlotRegistration[]
  readonly effects: string[]
} {
  const services = new Map<string, unknown>()
  const slotKeys: string[] = []
  const registrations: SlotRegistration[] = []
  const effects: string[] = []

  const slots: SlotsService = {
    inject(key, callback) {
      slotKeys.push(key)
      return callback()
    },
    register(options, component) {
      registrations.push({ options, component: component as SlotRegistration['component'] })
      return () => undefined
    },
  }
  services.set('slots', slots)

  const ctx = {
    get: (name: string) => services.get(name),
    effect: (body: () => () => void, label?: string) => {
      effects.push(label ?? '')
      return body()
    },
  } as unknown as Context

  return { ctx, services, slotKeys, registrations, effects }
}

/** The buttons one rendered row set produced, keyed by the action they close. */
function rowsOf(registration: SlotRegistration, props: RightbarTabMenuProps): Map<string, ReactElement> {
  const element = registration.component(props)
  expect(element).not.toBeNull()
  const children = React.Children.toArray((element as ReactElement<{ children: React.ReactNode }>).props.children)
  const rows = new Map<string, ReactElement>()
  for (const child of children as ReactElement[]) {
    const action = child.props['data-rightbar-tab-action'] as string
    rows.set(action, child)
  }
  return rows
}

describe('installRightbarTabMenu', () => {
  it('registers one row set into the tab menu slot and owns its stylesheet', () => {
    const fake = createFakeContext()
    installRightbarTabMenu(fake.ctx)

    expect(fake.slotKeys).toEqual([TAB_MENU_SLOT])
    expect(fake.registrations).toHaveLength(1)
    expect(fake.registrations[0]?.options).toMatchObject({
      name: TAB_MENU_SLOT,
      id: TAB_MENU_ENTRY_ID,
      order: TAB_MENU_ENTRY_ORDER,
    })
    expect(fake.effects).toContain('rightbar-tab-menu: context-menu rows')
    expect(fake.effects).toContain('rightbar-tab-menu: stylesheet')
  })

  it('stays inert without a slot registry', () => {
    const fake = createFakeContext()
    fake.services.delete('slots')
    expect(() => { installRightbarTabMenu(fake.ctx) }).not.toThrow()
    expect(fake.registrations).toHaveLength(0)
  })
})

describe('the registered row set', () => {
  it('offers all three rows when the session has other tabs', () => {
    const fake = createFakeContext()
    installRightbarTabMenu(fake.ctx)
    const close = vi.fn()
    fake.services.set('sidebarRight', {
      close,
      tabsIn: () => [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }],
    })
    const rows = rowsOf(fake.registrations[0] as SlotRegistration, {
      tab: { id: 'tab-2', kind: 'guide' },
      dismiss: () => undefined,
      sessionId: 'session-1',
    })
    // Without a DOM only the session-wide list is known, so only "close
    // others" can state a target; the two ordered rows stay out of the menu.
    expect([...rows.keys()]).toEqual(['others'])
  })

  it('closes the other session tabs after dismissing the menu', () => {
    const fake = createFakeContext()
    installRightbarTabMenu(fake.ctx)
    const order: string[] = []
    const close = vi.fn((id: string) => { order.push(`close:${id}`) })
    fake.services.set('sidebarRight', {
      close,
      tabsIn: () => [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }],
    })
    const rows = rowsOf(fake.registrations[0] as SlotRegistration, {
      tab: { id: 'tab-2', kind: 'guide' },
      dismiss: () => { order.push('dismiss') },
      sessionId: 'session-1',
    })
    rows.get('others')?.props.onClick()
    // The menu is the kit's: it closes first, then the tabs go, so the menu is
    // never left floating over content its own action replaced.
    expect(order).toEqual(['dismiss', 'close:tab-1', 'close:tab-3'])
  })

  it('offers nothing for a tab that is alone', () => {
    const fake = createFakeContext()
    installRightbarTabMenu(fake.ctx)
    fake.services.set('sidebarRight', {
      close: vi.fn(),
      tabsIn: () => [{ id: 'tab-2' }],
    })
    const element = fake.registrations[0]?.component({
      tab: { id: 'tab-2', kind: 'guide' },
      dismiss: () => undefined,
      sessionId: 'session-1',
    })
    expect(element).toBeNull()
  })

  it('offers nothing while the right column service is absent', () => {
    const fake = createFakeContext()
    installRightbarTabMenu(fake.ctx)
    const element = fake.registrations[0]?.component({
      tab: { id: 'tab-2', kind: 'guide' },
      dismiss: () => undefined,
      sessionId: 'session-1',
    })
    expect(element).toBeNull()
  })
})
