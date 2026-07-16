import type { EventEnvelope } from './envelope.js'

/**
 * Upcaster: a payload transformation that lifts one version to the next.
 * Maps from `version N` to `version N+1` payload shape.
 * Pure function; never mutates the input envelope.
 *
 * @example
 * // v1 { amount } → v2 { amountMinor, currency }
 * const upv1to2 = (p: { amount: number }) => ({
 *   amountMinor: p.amount,
 *   currency: 'MYR'
 * })
 */
export type Upcaster<From = unknown, To = unknown> = (payload: From) => To

/**
 * Event schema evolution registry. Maps (type, fromVersion) → upcaster → fromVersion+1.
 * The append-only journal outlives every payload shape it ever held.
 * A consumer reading years of history must upcast old events forward to today's schema.
 *
 * **The rule:** A payload change is never an edit — it is a new version + an upcaster + a test.
 * This ensures the upgrade path is always a single unambiguous chain (never a fork).
 *
 * @example
 * const reg = new UpcasterRegistry()
 * reg.register<OldShape, NewShape>('invoice.posted', 1, (old) => ({ ...old, newField: 0 }))
 * const upcast = reg.upcast(envelope) // walks v1 → v2 → v3 if upcasters exist
 * expect(upcast.version).toBe(3) // terminal version
 */
export class UpcasterRegistry {
  /** type → (fromVersion → upcaster to fromVersion+1). */
  private readonly chains = new Map<string, Map<number, Upcaster>>()

  /**
   * Register the transform that lifts `type`@`fromVersion` to `fromVersion + 1`.
   * A second registration for the same (type, fromVersion) throws to prevent ambiguous upgrade paths.
   *
   * @param type - Event type identifier
   * @param fromVersion - Starting version (must be a positive integer)
   * @param up - Upcaster function
   * @returns this for chaining
   * @throws If fromVersion is invalid or an upcaster for this pair already exists
   */
  register<From = unknown, To = unknown>(type: string, fromVersion: number, up: Upcaster<From, To>): this {
    if (!Number.isInteger(fromVersion) || fromVersion < 1) {
      throw new Error(`fromVersion must be a positive integer, got ${fromVersion}`)
    }
    let chain = this.chains.get(type)
    if (!chain) {
      chain = new Map()
      this.chains.set(type, chain)
    }
    if (chain.has(fromVersion)) {
      throw new Error(`duplicate upcaster for ${type}@${fromVersion} → ${fromVersion + 1}`)
    }
    chain.set(fromVersion, up as Upcaster)
    return this
  }

  /**
   * The highest version reachable for `type` by chaining from v1.
   * Returns 1 if the type has no upcasters (no evolution yet).
   *
   * @param type - Event type identifier
   * @returns Latest version number
   */
  latestVersion(type: string): number {
    const chain = this.chains.get(type)
    if (!chain || chain.size === 0) return 1
    let version = 1
    while (chain.has(version)) version++
    return version
  }

  /**
   * Upcast one envelope to its latest version, walking the chain from env.version upward.
   * Applies each upcaster in sequence until no further upcaster exists.
   * Pure — never mutates the input envelope.
   *
   * If the type has no upcasters or the envelope is already at the latest version,
   * the envelope is returned unchanged (but with version/payload in the return type parameter).
   *
   * @param env - EventEnvelope to upcast
   * @returns New envelope with latest version and transformed payload; input unchanged
   * @throws If a cycle is detected in the upcaster chain (should never happen with correct registration)
   */
  upcast<T = unknown>(env: EventEnvelope): EventEnvelope<T> {
    const chain = this.chains.get(env.type)
    let version = env.version
    let payload: unknown = env.payload
    if (chain) {
      const seen = new Set<number>()
      while (chain.has(version)) {
        if (seen.has(version)) throw new Error(`cycle in upcaster chain for ${env.type}@${version}`)
        seen.add(version)
        payload = chain.get(version)!(payload)
        version++
      }
    }
    return { ...env, version, payload: payload as T }
  }
}
