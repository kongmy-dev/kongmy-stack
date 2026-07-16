// Run via `bun run test` — raw `bun test` times out (suite needs --timeout 120000)

import { test, expect } from 'bun:test'
import { EventBus, type EventEnvelope } from '../src/index'

function mockEvent(type: string): EventEnvelope {
  return {
    id: 'ev-1',
    type,
    version: 1,
    orgId: 'org-1',
    branchId: null,
    seq: 1,
    hlc: '000:001',
    actor: { id: 'sys', type: 'system', model: null },
    causationId: null,
    correlationId: 'trace-1',
    payload: { demo: true },
    createdAt: '2026-07-16T00:00:00.000Z',
  }
}

test('EventBus.on subscribes to a specific event type', async () => {
  const bus = new EventBus()
  const events: EventEnvelope[] = []
  const unsub = bus.on('invoice.posted', (e) => events.push(e))

  const inv = mockEvent('invoice.posted')
  await bus.publish(inv)

  expect(events).toHaveLength(1)
  expect(events[0].type).toBe('invoice.posted')

  unsub()
  await bus.publish(inv)
  expect(events).toHaveLength(1) // unsubscribed, no new event
})

test('EventBus.on returns an unsubscribe function', async () => {
  const bus = new EventBus()
  const events: EventEnvelope[] = []
  const unsub = bus.on('order.created', (e) => events.push(e))

  const order = mockEvent('order.created')
  await bus.publish(order)
  expect(events).toHaveLength(1)

  unsub()
  await bus.publish(order)
  expect(events).toHaveLength(1) // no new event after unsubscribe
})

test('EventBus wildcard subscription receives all events', async () => {
  const bus = new EventBus()
  const allEvents: EventEnvelope[] = []
  bus.on('*', (e) => allEvents.push(e))

  const inv = mockEvent('invoice.posted')
  const order = mockEvent('order.created')

  await bus.publish(inv)
  await bus.publish(order)

  expect(allEvents).toHaveLength(2)
  expect(allEvents[0].type).toBe('invoice.posted')
  expect(allEvents[1].type).toBe('order.created')
})

test('EventBus type-specific and wildcard subscribers both fire', async () => {
  const bus = new EventBus()
  const specific: EventEnvelope[] = []
  const wildcard: EventEnvelope[] = []

  bus.on('invoice.posted', (e) => specific.push(e))
  bus.on('*', (e) => wildcard.push(e))

  const inv = mockEvent('invoice.posted')
  await bus.publish(inv)

  expect(specific).toHaveLength(1)
  expect(wildcard).toHaveLength(1)
})

test('EventBus multiple subscribers to the same type all receive the event', async () => {
  const bus = new EventBus()
  const sub1Events: EventEnvelope[] = []
  const sub2Events: EventEnvelope[] = []

  bus.on('demo.event', (e) => sub1Events.push(e))
  bus.on('demo.event', (e) => sub2Events.push(e))

  const e = mockEvent('demo.event')
  await bus.publish(e)

  expect(sub1Events).toHaveLength(1)
  expect(sub2Events).toHaveLength(1)
})

test('EventBus supports async subscribers', async () => {
  const bus = new EventBus()
  let processed = false

  bus.on('async.event', async (e) => {
    await new Promise((r) => setTimeout(r, 10))
    processed = true
  })

  const e = mockEvent('async.event')
  await bus.publish(e)

  expect(processed).toBe(true)
})

test('EventBus awaits all subscribers before returning', async () => {
  const bus = new EventBus()
  const order: string[] = []

  bus.on('sync.event', async (e) => {
    await new Promise((r) => setTimeout(r, 20))
    order.push('first')
  })
  bus.on('sync.event', async (e) => {
    await new Promise((r) => setTimeout(r, 10))
    order.push('second')
  })

  const e = mockEvent('sync.event')
  await bus.publish(e)

  // Both async handlers complete before publish returns
  expect(order).toContain('first')
  expect(order).toContain('second')
})

test('EventBus does not subscribe to non-existent types by default', async () => {
  const bus = new EventBus()
  const events: EventEnvelope[] = []

  bus.on('typed.event', (e) => events.push(e))

  const other = mockEvent('other.event')
  await bus.publish(other)

  expect(events).toHaveLength(0)
})

test('EventBus wildcard does not interfere with type-specific subscriptions', async () => {
  const bus = new EventBus()
  const wildcard: EventEnvelope[] = []
  const specific: EventEnvelope[] = []

  bus.on('*', (e) => wildcard.push(e))
  bus.on('invoice.posted', (e) => specific.push(e))

  const inv = mockEvent('invoice.posted')
  const order = mockEvent('order.created')

  await bus.publish(inv)
  await bus.publish(order)

  expect(wildcard).toHaveLength(2) // sees both
  expect(specific).toHaveLength(1) // sees only invoice
})
