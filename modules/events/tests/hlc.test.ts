// Run via `bun run test` — raw `bun test` times out (suite needs --timeout 120000)

import { test, expect } from 'bun:test'
import { Hlc, encodeHlc } from '../src/hlc'

test('HLC.send is strictly monotonic even when the wall clock stalls', () => {
  let fixedTime = 1000
  const hlc = new Hlc(() => fixedTime)

  const a = hlc.send()
  const b = hlc.send() // same wall time → counter must advance
  const c = (() => {
    fixedTime = 2000
    return hlc.send() // wall advanced → counter resets
  })()

  expect(a.counter).toBe(0)
  expect(b.counter).toBe(1)
  expect(c.wallMs).toBe(2000)
  expect(c.counter).toBe(0)

  // Lexicographic ordering matches logical ordering
  expect(encodeHlc(a) < encodeHlc(b)).toBe(true)
  expect(encodeHlc(b) < encodeHlc(c)).toBe(true)
})

test('HLC.receive preserves causality against a future remote timestamp', () => {
  const hlc = new Hlc(() => 1000)
  const merged = hlc.receive({ wallMs: 5000, counter: 3 })

  expect(merged.wallMs).toBe(5000)
  expect(merged.counter).toBe(4) // remote.counter + 1
})

test('HLC.receive increments counter when local and remote times are equal', () => {
  const hlc = new Hlc(() => 1000)
  hlc.send() // { wallMs: 1000, counter: 0 }

  const merged = hlc.receive({ wallMs: 1000, counter: 2 })
  expect(merged.wallMs).toBe(1000)
  expect(merged.counter).toBe(3) // max(local=0, remote=2) + 1
})

test('HLC.receive increments counter when wall time is the maximum', () => {
  const hlc = new Hlc(() => 3000)
  hlc.send() // { wallMs: 3000, counter: 0 }

  const merged = hlc.receive({ wallMs: 1000, counter: 10 })
  expect(merged.wallMs).toBe(3000) // wall time is max
  expect(merged.counter).toBe(1) // local.counter + 1
})

test('encodeHlc produces a lexicographically sortable string', () => {
  const ts1 = { wallMs: 100, counter: 0 }
  const ts2 = { wallMs: 100, counter: 1 }
  const ts3 = { wallMs: 200, counter: 0 }

  const enc1 = encodeHlc(ts1)
  const enc2 = encodeHlc(ts2)
  const enc3 = encodeHlc(ts3)

  expect(enc1 < enc2).toBe(true)
  expect(enc2 < enc3).toBe(true)
  expect(enc1 < enc3).toBe(true)
})

test('encodeHlc pads correctly for large wall times', () => {
  const ts = { wallMs: 0xffffffffffff, counter: 0xffff }
  const encoded = encodeHlc(ts)
  // Should be 12 hex digits + ':' + 4 hex digits
  expect(encoded).toBe('ffffffffffff:ffff')
})

test('HLC.send multiple times with stalled clock maintains strict ordering', () => {
  let fixed = 5000
  const hlc = new Hlc(() => fixed)

  const ts1 = hlc.send()
  const ts2 = hlc.send()
  const ts3 = hlc.send()
  const ts4 = hlc.send()

  expect(ts1.counter).toBe(0)
  expect(ts2.counter).toBe(1)
  expect(ts3.counter).toBe(2)
  expect(ts4.counter).toBe(3)

  const encoded = [ts1, ts2, ts3, ts4].map(encodeHlc)
  for (let i = 0; i < encoded.length - 1; i++) {
    expect(encoded[i] < encoded[i + 1]).toBe(true)
  }
})

test('HLC.receive on a stalled clock advances counter', () => {
  let wall = 1000
  const hlc = new Hlc(() => wall)

  hlc.send() // { wallMs: 1000, counter: 0 }
  // Clock stalls, we receive a remote event from the past
  const merged = hlc.receive({ wallMs: 500, counter: 5 })

  expect(merged.wallMs).toBe(1000) // local is max
  expect(merged.counter).toBe(1) // local.counter + 1
})
