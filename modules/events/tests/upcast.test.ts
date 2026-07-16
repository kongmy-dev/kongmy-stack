// Run via `bun run test` — raw `bun test` times out (suite needs --timeout 120000)

import { test, expect } from 'bun:test'
import { UpcasterRegistry, type EventEnvelope } from '../src/index'

function env<T>(type: string, version: number, payload: T): EventEnvelope<T> {
  return {
    id: 'ev-1',
    type,
    version,
    orgId: 'org-1',
    branchId: 'br-1',
    seq: 1,
    hlc: '0',
    actor: { id: 'a', type: 'system', model: null },
    causationId: null,
    correlationId: 'c-1',
    payload,
    createdAt: '2026-07-12T00:00:00.000Z',
  }
}

test('a single upcaster lifts a v1 envelope to v2 and transforms the payload', () => {
  const reg = new UpcasterRegistry()
  // v1: { amount } → v2: { amountMinor, currency }
  reg.register<{ amount: number }, { amountMinor: number; currency: string }>('demo.priced', 1, (p) => ({
    amountMinor: p.amount,
    currency: 'MYR',
  }))

  const up = reg.upcast(env('demo.priced', 1, { amount: 1500 }))
  expect(up.version).toBe(2)
  expect(up.payload).toEqual({ amountMinor: 1500, currency: 'MYR' })
})

test('upcasters chain from the envelope version up to the latest', () => {
  const reg = new UpcasterRegistry()
  reg.register<{ a: number }, { a: number; b: number }>('demo.grown', 1, (p) => ({ ...p, b: 0 }))
  reg.register<{ a: number; b: number }, { a: number; b: number; c: number }>(
    'demo.grown',
    2,
    (p) => ({ ...p, c: p.a + p.b }),
  )

  expect(reg.latestVersion('demo.grown')).toBe(3)
  const up = reg.upcast(env('demo.grown', 1, { a: 5 }))
  expect(up.version).toBe(3)
  expect(up.payload).toEqual({ a: 5, b: 0, c: 5 })
})

test('an envelope already at the latest version is returned unchanged', () => {
  const reg = new UpcasterRegistry()
  reg.register('demo.grown', 1, (p) => p)
  const original = env('demo.grown', 2, { a: 9 })
  const up = reg.upcast(original)
  expect(up.version).toBe(2)
  expect(up.payload).toEqual({ a: 9 })
})

test('a type with no upcasters passes through untouched (and reports latest = 1)', () => {
  const reg = new UpcasterRegistry()
  expect(reg.latestVersion('demo.unknown')).toBe(1)
  const up = reg.upcast(env('demo.unknown', 1, { x: 1 }))
  expect(up.version).toBe(1)
  expect(up.payload).toEqual({ x: 1 })
})

test('registering two upcasters for the same (type, version) is refused — one chain only', () => {
  const reg = new UpcasterRegistry()
  reg.register('demo.priced', 1, (p) => p)
  expect(() => reg.register('demo.priced', 1, (p) => p)).toThrow(/duplicate upcaster/)
})

test('upcast does not mutate the input envelope', () => {
  const reg = new UpcasterRegistry()
  reg.register<{ a: number }, { a: number; b: number }>('demo.grown', 1, (p) => ({ ...p, b: 1 }))
  const input = env('demo.grown', 1, { a: 7 })
  reg.upcast(input)
  expect(input.version).toBe(1)
  expect(input.payload).toEqual({ a: 7 })
})

test('upcaster with invalid fromVersion throws', () => {
  const reg = new UpcasterRegistry()
  expect(() => reg.register('demo.type', 0, (p) => p)).toThrow(/fromVersion must be a positive integer/)
  expect(() => reg.register('demo.type', -1, (p) => p)).toThrow(/fromVersion must be a positive integer/)
})

test('latestVersion returns 1 for types with no upcasters', () => {
  const reg = new UpcasterRegistry()
  expect(reg.latestVersion('unknown.type')).toBe(1)
})

test('chaining multiple upcasters works for long evolution chains', () => {
  const reg = new UpcasterRegistry()
  reg.register('chain.event', 1, (p: { x: number }) => ({ x: p.x, y: 0 }))
  reg.register('chain.event', 2, (p: { x: number; y: number }) => ({ x: p.x, y: p.y, z: 0 }))
  reg.register('chain.event', 3, (p: { x: number; y: number; z: number }) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    w: p.x + p.y + p.z,
  }))

  expect(reg.latestVersion('chain.event')).toBe(4)
  const up = reg.upcast(env('chain.event', 1, { x: 10 }))
  expect(up.version).toBe(4)
  expect(up.payload).toEqual({ x: 10, y: 0, z: 0, w: 10 })
})

test('upcast preserves all envelope fields except version and payload', () => {
  const reg = new UpcasterRegistry()
  reg.register('test', 1, (p: { a: number }) => ({ a: p.a * 2 }))

  const original = env('test', 1, { a: 5 })
  const upcasted = reg.upcast(original)

  expect(upcasted.id).toBe(original.id)
  expect(upcasted.type).toBe(original.type)
  expect(upcasted.orgId).toBe(original.orgId)
  expect(upcasted.branchId).toBe(original.branchId)
  expect(upcasted.seq).toBe(original.seq)
  expect(upcasted.hlc).toBe(original.hlc)
  expect(upcasted.actor).toEqual(original.actor)
  expect(upcasted.causationId).toBe(original.causationId)
  expect(upcasted.correlationId).toBe(original.correlationId)
  expect(upcasted.createdAt).toBe(original.createdAt)
  // Only version and payload change
  expect(upcasted.version).toBe(2)
  expect(upcasted.payload).toEqual({ a: 10 })
})
