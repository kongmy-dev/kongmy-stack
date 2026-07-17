/**
 * Hybrid Logical Clock (HLC) — monotonic, causally-consistent timestamps across hosts
 * whose wall clocks drift. Essential for cross-branch event ordering (e.g. stock-transfer handshake).
 *
 * Within a single branch, the per-branch `seq` provides ordering.
 * Across branches, HLC ensures causality: if branch A replicates an event to branch B,
 * HLC preserves the causal relationship so B's response can't appear to happen before A's originating event.
 */
export interface HlcTimestamp {
  wallMs: number
  counter: number
}

/**
 * Counter ceiling imposed by the wire format: `encodeHlc` gives the counter 4 hex digits.
 * A counter at or past this cannot be encoded without losing ordering, so the clock carries the
 * overflow into `wallMs` instead (see `carry`). HLC wall time is logical and may legitimately run
 * ahead of the physical clock — that is what makes this safe rather than a fudge.
 */
const MAX_COUNTER = 0xffff

/** Wall-time ceiling imposed by the wire format: 12 hex digits (48-bit ms, ~year 10889). */
const MAX_WALL_MS = 0xffffffffffff

/**
 * Normalize a timestamp so its counter always fits the encoding.
 * Overflow becomes wall-time advance, which keeps the encoded form strictly increasing.
 */
function carry(ts: HlcTimestamp): HlcTimestamp {
  if (ts.counter <= MAX_COUNTER) return ts
  return { wallMs: ts.wallMs + Math.floor(ts.counter / (MAX_COUNTER + 1)), counter: ts.counter % (MAX_COUNTER + 1) }
}

/**
 * Hybrid Logical Clock — generate and merge timestamps while preserving causality.
 * Stateful; call send() for locally-produced events and receive() when learning about remote events.
 */
export class Hlc {
  private last: HlcTimestamp = { wallMs: 0, counter: 0 }

  /**
   * Create an HLC instance.
   * @param now - Clock function (defaults to Date.now). Inject for testing.
   */
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Stamp a locally-produced event.
   * Returns a new HLC timestamp that is strictly greater than any prior timestamp from this instance.
   * If wall time has advanced, resets counter to 0; else increments counter to preserve monotonicity.
   */
  send(): HlcTimestamp {
    const wall = this.now()
    this.last = carry(
      wall > this.last.wallMs
        ? { wallMs: wall, counter: 0 }
        : { wallMs: this.last.wallMs, counter: this.last.counter + 1 },
    )
    return this.last
  }

  /**
   * Merge an incoming remote timestamp, preserving causality.
   * If the remote timestamp is from the future, advances to that future and increments counter.
   * If times are equal, increments counter to ensure no two different events get the same timestamp.
   * Ensures: merged result > max(local.last, remote, wallClock).
   *
   * @param remote - Timestamp from a remote event
   * @returns Merged HLC timestamp
   */
  receive(remote: HlcTimestamp): HlcTimestamp {
    const wall = this.now()
    const maxWall = Math.max(wall, this.last.wallMs, remote.wallMs)
    let counter: number
    if (maxWall === this.last.wallMs && maxWall === remote.wallMs) {
      // All three times equal: increment to diverge from both
      counter = Math.max(this.last.counter, remote.counter) + 1
    } else if (maxWall === this.last.wallMs) {
      // Local time is max: increment to move forward
      counter = this.last.counter + 1
    } else if (maxWall === remote.wallMs) {
      // Remote time is max: increment to move forward
      counter = remote.counter + 1
    } else {
      // Wall time is max: reset counter
      counter = 0
    }
    // A remote counter near the ceiling would otherwise push us past what encodeHlc can represent.
    this.last = carry({ wallMs: maxWall, counter })
    return this.last
  }
}

/**
 * Lexicographically sortable string encoding of HLC timestamp.
 * Format: 12 hex digits (48-bit ms) + ':' + 4 hex digits (16-bit counter).
 * Lexicographic ordering matches logical ordering: earlier timestamps sort before later ones.
 *
 * Timestamps from `Hlc` always fit, because the clock carries counter overflow into `wallMs`.
 * A hand-built timestamp that does not fit throws rather than wraps: masking the counter to 16 bits
 * silently maps 65536 → '0000', which sorts *below* every earlier stamp in the same millisecond and
 * inverts the causality this encoding exists to preserve.
 *
 * @param ts - HLC timestamp to encode
 * @returns Sortable string representation (e.g. '00000000000f:0000')
 * @throws If the timestamp cannot be represented without breaking sort order
 */
export function encodeHlc(ts: HlcTimestamp): string {
  if (!Number.isInteger(ts.counter) || ts.counter < 0 || ts.counter > MAX_COUNTER) {
    throw new Error(`hlc counter out of range for encoding: ${ts.counter} (max ${MAX_COUNTER})`)
  }
  if (!Number.isInteger(ts.wallMs) || ts.wallMs < 0 || ts.wallMs > MAX_WALL_MS) {
    throw new Error(`hlc wallMs out of range for encoding: ${ts.wallMs} (max ${MAX_WALL_MS})`)
  }
  const ms = ts.wallMs.toString(16).padStart(12, '0')
  const ctr = ts.counter.toString(16).padStart(4, '0')
  return `${ms}:${ctr}`
}
