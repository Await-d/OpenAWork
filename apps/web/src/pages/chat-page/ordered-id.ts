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
