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
    this.last =
      wall > this.last.wallMs
        ? { wallMs: wall, counter: 0 }
        : { wallMs: this.last.wallMs, counter: this.last.counter + 1 }
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
    this.last = { wallMs: maxWall, counter }
    return this.last
  }
}

/**
 * Lexicographically sortable string encoding of HLC timestamp.
 * Format: 12 hex digits (48-bit ms) + ':' + 4 hex digits (16-bit counter).
 * Lexicographic ordering matches logical ordering: earlier timestamps sort before later ones.
 *
 * @param ts - HLC timestamp to encode
 * @returns Sortable string representation (e.g. '00000000000f:0000')
 */
export function encodeHlc(ts: HlcTimestamp): string {
  const ms = ts.wallMs.toString(16).padStart(12, '0')
  const ctr = (ts.counter & 0xffff).toString(16).padStart(4, '0')
  return `${ms}:${ctr}`
}
