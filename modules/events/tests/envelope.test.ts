// Run via `bun run test` — raw `bun test` times out (suite needs --timeout 120000)

import { test, expect } from 'bun:test'
import { EventEnvelopeSchema, DomainEventSchema, sealEvent, ActorTypeSchema, ActorSchema, SealContextSchema } from '../src/envelope'

test('EventEnvelopeSchema validates a complete envelope', () => {
  const envelope = {
    id: 'ev-001',
    type: 'invoice.posted',
    version: 1,
    orgId: 'org-123',
    branchId: 'branch-456',
    seq: 1,
    hlc: '00000000000a:0001',
    actor: { id: 'user-1', type: 'human' as const, model: null },
    causationId: 'cmd-789',
    correlationId: 'trace-abc',
    payload: { invoiceId: 'inv-001', amount: 10000 },
    createdAt: '2026-07-16T00:00:00.000Z',
  }
  const result = EventEnvelopeSchema.safeParse(envelope)
  expect(result.success).toBe(true)
})

test('EventEnvelopeSchema rejects invalid actor type', () => {
  const envelope = {
    id: 'ev-001',
    type: 'invoice.posted',
    version: 1,
    orgId: 'org-123',
    branchId: null,
    seq: 1,
    hlc: '00000000000a:0001',
    actor: { id: 'user-1', type: 'invalid' as never, model: null },
    causationId: null,
    correlationId: 'trace-abc',
    payload: {},
    createdAt: '2026-07-16T00:00:00.000Z',
  }
  const result = EventEnvelopeSchema.safeParse(envelope)
  expect(result.success).toBe(false)
})

test('DomainEventSchema validates domain events with and without version', () => {
  const e1 = { type: 'invoice.posted', payload: { amount: 1000 } }
  const e2 = { type: 'invoice.posted', payload: { amount: 1000 }, version: 2 }
  expect(DomainEventSchema.safeParse(e1).success).toBe(true)
  expect(DomainEventSchema.safeParse(e2).success).toBe(true)
})

test('sealEvent generates a valid EventEnvelope with new ID and timestamp', () => {
  const domain = { type: 'order.created', payload: { orderId: 'ord-001' }, version: 1 }
  const ctx = {
    orgId: 'org-123',
    branchId: null,
    actor: { id: 'user-1', type: 'human' as const, model: null },
    causationId: null,
    correlationId: 'trace-123',
    seq: 5,
    hlc: '00000000000f:0002',
  }

  const sealed = sealEvent(domain, ctx)

  expect(sealed.type).toBe('order.created')
  expect(sealed.version).toBe(1)
  expect(sealed.orgId).toBe('org-123')
  expect(sealed.branchId).toBeNull()
  expect(sealed.seq).toBe(5)
  expect(sealed.hlc).toBe('00000000000f:0002')
  expect(sealed.actor).toEqual(ctx.actor)
  expect(sealed.causationId).toBeNull()
  expect(sealed.correlationId).toBe('trace-123')
  expect(sealed.payload).toEqual({ orderId: 'ord-001' })
  expect(sealed.id).toMatch(/^[\w-]+$/) // ULID-like
  expect(sealed.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
})

test('sealEvent defaults version to 1 if not provided', () => {
  const domain = { type: 'demo.event', payload: { x: 1 } } // no version
  const ctx = {
    orgId: 'org-1',
    branchId: null,
    actor: { id: 'a', type: 'system' as const, model: null },
    causationId: null,
    correlationId: 'c',
    seq: 1,
    hlc: '000:001',
  }
  const sealed = sealEvent(domain, ctx)
  expect(sealed.version).toBe(1)
})

test('ActorTypeSchema accepts all valid types', () => {
  expect(ActorTypeSchema.safeParse('human').success).toBe(true)
  expect(ActorTypeSchema.safeParse('agent').success).toBe(true)
  expect(ActorTypeSchema.safeParse('system').success).toBe(true)
})

test('SealContextSchema validates tenancy and metadata', () => {
  const ctx = {
    orgId: 'org-1',
    branchId: 'br-1',
    actor: { id: 'user-1', type: 'human' as const, model: null },
    causationId: 'cmd-1',
    correlationId: 'trace-1',
    seq: 10,
    hlc: '000:010',
  }
  const result = SealContextSchema.safeParse(ctx)
  expect(result.success).toBe(true)
})
