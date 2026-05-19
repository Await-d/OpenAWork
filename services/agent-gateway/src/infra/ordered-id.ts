/**
 * Ordered ID generator — produces lexicographically sortable identifiers.
 *
 * Format: `<prefix>_<12-char-hex-timestamp><14-char-random-base62>`
 * - Timestamp is encoded as 6 bytes (48 bits) in big-endian hex, ensuring
 *   IDs created later always sort after IDs created earlier.
 * - Same-millisecond calls use a monotonic counter to guarantee strict ordering.
 * - Random suffix provides uniqueness across processes/machines.
 *
 * Ported from opencode's Identifier module with adjusted prefix conventions.
 */

import { randomBytes } from 'node:crypto';

const PREFIXES = {
  message: 'msg',
  part: 'prt',
  session: 'ses',
  event: 'evt',
} as const;

type PrefixKey = keyof typeof PREFIXES;

const RANDOM_SUFFIX_LENGTH = 14;
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

let lastTimestamp = 0;
let counter = 0;

function randomBase62(length: number): string {
  const bytes = randomBytes(length);
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

  // Encode timestamp + counter into 48 bits (same layout as opencode)
  const now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter);

  const timeBytes = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff));
  }

  return `${PREFIXES[prefix]}_${timeBytes.toString('hex')}${randomBase62(RANDOM_SUFFIX_LENGTH)}`;
}

/**
 * Generate an ordered message ID. Lexicographically sortable by creation time.
 * Format: `msg_<12-hex-timestamp><14-random-base62>`
 */
export function makeOrderedMessageId(timestamp?: number): string {
  return createOrderedId('message', timestamp);
}

/**
 * Generate an ordered part ID. Lexicographically sortable by creation time.
 * Format: `prt_<12-hex-timestamp><14-random-base62>`
 */
export function makeOrderedPartId(timestamp?: number): string {
  return createOrderedId('part', timestamp);
}

/**
 * Generate an ordered event ID.
 * Format: `evt_<12-hex-timestamp><14-random-base62>`
 */
export function makeOrderedEventId(timestamp?: number): string {
  return createOrderedId('event', timestamp);
}

/**
 * Extract the embedded timestamp from an ordered ID (ascending only).
 * Returns `null` if the ID does not match the expected format.
 */
export function extractTimestampFromOrderedId(id: string): number | null {
  const prefix = id.split('_')[0];
  if (!prefix) return null;
  const hex = id.slice(prefix.length + 1, prefix.length + 13);
  if (hex.length !== 12) return null;
  const encoded = BigInt(`0x${hex}`);
  return Number(encoded / BigInt(0x1000));
}
