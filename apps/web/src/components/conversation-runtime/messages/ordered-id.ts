/**
 * Browser-compatible ordered ID generator.
 *
 * Produces lexicographically sortable identifiers whose dictionary order
 * matches creation time, matching the backend's ordered-id.ts format.
 *
 * Format: `msg_<12-char-hex-timestamp><14-char-random-base62>`
 */

const PREFIXES = {
  message: 'msg',
  part: 'prt',
} as const;

type PrefixKey = keyof typeof PREFIXES;

const RANDOM_SUFFIX_LENGTH = 14;
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

let lastTimestamp = 0;
let counter = 0;

function randomBase62(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE62_CHARS[bytes[i]! % 62]!;
  }
  return result;
}

function createOrderedId(prefix: PrefixKey, timestamp?: number): string {
  const currentTimestamp = timestamp ?? Date.now();

  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp;
    counter = 0;
  }
  counter += 1;

  const now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter);

  const timeBytes = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff));
  }

  const hex = Array.from(timeBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${PREFIXES[prefix]}_${hex}${randomBase62(RANDOM_SUFFIX_LENGTH)}`;
}

/**
 * Generate an ordered message ID (browser-compatible).
 * Format: `msg_<12-hex-timestamp><14-random-base62>`
 */
export function makeOrderedMessageId(timestamp?: number): string {
  return createOrderedId('message', timestamp);
}

/** Low bits of the encoded 48-bit timestamp field reserved for the same-millisecond counter. */
const COUNTER_BITS = 12n;
const COUNTER_MASK = (1n << COUNTER_BITS) - 1n;
const ENCODED_TIMESTAMP_MASK = (1n << 48n) - 1n;
/** The encoder keeps `timestamp mod 2^36`, so ids wrap roughly every 795 days. */
const ORDERED_ID_TIME_PERIOD_MS = Number(1n << 36n);

interface DecodedOrderedIdTime {
  counter: number;
  /** `timestamp mod 2^36` — the absolute millisecond value is ambiguous. */
  truncatedTimeMs: number;
}

function decodeOrderedIdTime(id: string): DecodedOrderedIdTime | null {
  const hex = /^[a-z]+_([0-9a-f]{12})/.exec(id)?.[1];
  if (!hex) return null;
  const encoded = BigInt(`0x${hex}`);
  return {
    counter: Number(encoded & COUNTER_MASK),
    truncatedTimeMs: Number((encoded & ENCODED_TIMESTAMP_MASK) >> COUNTER_BITS),
  };
}

/**
 * Compare two ordered ids by their embedded creation time.
 *
 * Only 48 bits of `timestamp * 0x1000` survive, so the decoded time is
 * `timestamp mod 2^36` and wraps roughly every 795 days. Comparing raw id
 * strings inverts the order of any two ids that straddle a wrap. Re-anchoring
 * each decoded time to the period nearest `referenceMs` restores the true order
 * for any two ids less than one period apart (≈795 days), which covers every
 * realistic session span.
 *
 * Returns `null` when either id does not carry the ordered-id shape.
 */
export function compareOrderedIds(
  left: string,
  right: string,
  referenceMs: number = Date.now(),
): number | null {
  if (left === right) return 0;
  const leftDecoded = decodeOrderedIdTime(left);
  const rightDecoded = decodeOrderedIdTime(right);
  if (!leftDecoded || !rightDecoded) return null;

  const anchor = (truncatedTimeMs: number): number =>
    truncatedTimeMs +
    ORDERED_ID_TIME_PERIOD_MS *
      Math.round((referenceMs - truncatedTimeMs) / ORDERED_ID_TIME_PERIOD_MS);

  const leftTime = anchor(leftDecoded.truncatedTimeMs);
  const rightTime = anchor(rightDecoded.truncatedTimeMs);
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  if (leftDecoded.counter !== rightDecoded.counter) {
    return leftDecoded.counter < rightDecoded.counter ? -1 : 1;
  }
  return left < right ? -1 : 1;
}
