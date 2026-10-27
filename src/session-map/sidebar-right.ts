/**
 * Shared plumbing for contributing a tab type to DSH's native right column.
 *
 * The right column is owned by another package (`ui-sidebar-right`), so its
 * services are not in this repository's declared surface. The shapes below are
 * the narrow structural view this plugin calls: the tab-type registry (stage
 * one), the slot registry a tab body registers into (stage two), and the
 * service lookup itself. They live in one module because two features now
 * contribute right-column pages — the Session map and the Git tool window — and
 * both need the same cold-boot handling and the same claim rules.
 *
 * @module dsh-session-map/session-map/sidebar-right
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'

/** Structural view of the context's untyped service lookup, which this program does not declare. */
export interface ServiceLocator {
  get(name: string): unknown
}

/** One entry's registration options, across the cardinalities this plugin uses. */
export interface SlotRegistrationOptions {
  readonly name: string
  /** List-cell key; required by a list slot. */
  readonly id?: string
  /** Keyed-cell key; required by a keyed slot. */
  readonly key?: string
  readonly order?: number
  /** Display text where the owner projects one; a thunk follows the active locale. */
  readonly label?: string | (() => string)
}

/** The slot-registry operations this plugin calls. */
export interface SlotsService {
  /**
   * Run a registration while a slot key is declared, and drop it when that declaration collapses.
   * @param key - the slot key to wait for.
   * @param callback - the registration body.
   * @returns the injected registration's disposer.
   */
  inject(key: string, callback: () => () => void): () => void
  /**
   * Register one entry into a declared slot.
   * @param options - the slot key plus the options its cardinality takes.
   * @param component - the entry's body.
   * @returns the registration's disposer.
   */
  register<P>(options: SlotRegistrationOptions, component: (props: P) => ReactElement): () => void
}

/** One guide-page capsule a tab type offers. */
export interface SidebarRightGuideEntry {
  readonly order: number
  readonly title: () => string
  readonly description?: (() => string) | undefined
}

/** One registered right-sidebar tab type, as this plugin declares it. */
export interface SidebarRightTabDefinition {
  readonly id: string
  readonly kind: string
  readonly title: (address: string) => string
  readonly guide?: readonly SidebarRightGuideEntry[] | undefined
}

/** The right-sidebar tab-type registry (stage one of a tab registration). */
export interface SidebarRightTabsService {
  /**
   * The type in force for a kind.
   * @param kind - the type discriminator.
   * @returns the type, or `undefined` when nothing registered it.
   */
  get(kind: string): SidebarRightTabDefinition | undefined
  /**
   * Register one tab type for the caller's lifetime.
   * @param definition - the contributed type.
   * @returns idempotent disposer.
   */
  register(definition: SidebarRightTabDefinition): () => void
}

/** A lifecycle effect body: what it installs, and the disposer that releases it. */
export type EffectBody = () => () => void

/**
 * Read one optional service from the global store.
 *
 * The context's declared surface carries none of these prerelease services, so
 * the lookup is typed here instead of imported; `undefined` means nothing is
 * providing the name right now.
 * @param ctx - the plugin's context.
 * @param name - the service name.
 * @returns the service as the caller's local interface, or `undefined`.
 */
export function lookup<T>(ctx: Context, name: string): T | undefined {
  const locator = ctx as unknown as ServiceLocator
  return locator.get(name) as T | undefined
}

/**
 * Build the effect body that claims one tab type.
 *
 * A page kept open across a host restart still runs the previous incarnation of
 * this plugin, which already holds the same type. Reusing that one is safe: the
 * bodies are re-registered separately under later priorities, so the new bodies
 * win. A DIFFERENT type holding the kind is a real wiring conflict and still
 * fails loud.
 * @param tabs - the native tab-type registry.
 * @returns a claim function; call it inside an effect to own the registration.
 */
export function createTypeClaimer(
  tabs: SidebarRightTabsService,
): (
  id: string,
  kind: string,
  title: () => string,
  guideTitle?: () => string,
  guideDescription?: () => string,
) => EffectBody {
  return (id, kind, title, guideTitle, guideDescription) => {
    return () => {
      const existing = tabs.get(kind)
      if (existing !== undefined) {
        if (existing.id === id) return () => {}
        throw new Error(
          'sidebarRight: kind "' + kind + '" is already held by tab type "' + existing.id + '"',
        )
      }
      const definition: SidebarRightTabDefinition = guideTitle === undefined
        ? { id, kind, title }
        : { id, kind, title, guide: [{ order: 20, title: guideTitle, description: guideDescription }] }
      return tabs.register(definition)
    }
  }
}
