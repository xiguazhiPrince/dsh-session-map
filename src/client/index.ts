/**
 * Browser half: the Session map plugin.
 *
 * This scaffold registers one Conversation tab, so the install path can be
 * verified end to end before the canvas is ported in. Services are read through
 * `ctx.get` against local structural types rather than the product's own
 * browser packages: those are published at a prerelease version, and this
 * repository deliberately does not pin them.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'

/** Plugin name the Loader reports for this bundle's browser half. */
export const name = 'dsh-session-map'

/** Hard dependency: there is nothing to register into before the slot registry exists. */
export const inject = ['slots']

/** Session list state, narrowed to the fields this plugin reads. */
interface SessionListState {
  readonly ids: readonly string[]
  readonly current?: string
}

/** The slot-registry operations this plugin calls. */
interface SlotsService {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** Props the slot renderer hands one `conversation.view` entry. */
interface ViewProps {
  useSessions<S>(select: (state: SessionListState) => S): S
  sessionId: string
}

/**
 * One Conversation tab.
 * @param props - composed slot props.
 * @returns the tab body.
 */
function SessionMapTab(props: ViewProps): React.ReactElement {
  const count = props.useSessions(state => state.ids.length)
  const current = props.useSessions(state => state.current)
  return React.createElement(
    'div',
    { style: { padding: '24px 28px', fontSize: 13, lineHeight: 1.6 } },
    React.createElement('div', { style: { fontSize: 15, fontWeight: 600 } }, '会话图谱'),
    React.createElement(
      'div',
      { style: { color: 'var(--dsw-alias-label-secondary)' } },
      `${String(count)} 个会话 · 当前 ${current ?? '未选择'}`,
    ),
  )
}

/**
 * Client plugin body: register the Conversation tab.
 *
 * The registry's own `provide` name is the argument here; the property face the
 * product's packages declare does not exist in this program, so the lookup goes
 * through a structural view of the context.
 * @param ctx - browser root context.
 */
export function apply(ctx: Context): void {
  const services = ctx as unknown as { get(name: string): unknown }
  const slots = services.get('slots') as SlotsService | undefined
  if (slots === undefined) return
  ctx.effect(() => slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'session-map', order: 30, label: '会话图谱' },
    SessionMapTab,
  )), 'session-map: conversation view entry')
}
