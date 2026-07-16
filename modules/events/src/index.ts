/**
 * @events-module
 *
 * Event backbone: envelope (zod), HLC timestamps, transactional outbox, in-proc pub/sub bus.
 * Portable: no product IP, WinterCG-clean code, works in Node, Bun, and Workers (with adapters).
 */

export * from './envelope.js'
export * from './hlc.js'
export * from './bus.js'
export * from './upcast.js'
export * from './outbox.js'
