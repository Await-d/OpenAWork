import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRandomUuid } from './random-uuid.js';

/** RFC 4122 v4 形状：版本位固定 4，变体位固定 8/9/a/b。 */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function replaceWebCrypto(value: unknown): void {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
}

describe('createRandomUuid', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    replaceWebCrypto(originalCrypto);
    vi.restoreAllMocks();
  });

  it('安全上下文下优先使用 crypto.randomUUID', () => {
    const spy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111');

    expect(createRandomUuid()).toBe('11111111-1111-4111-8111-111111111111');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('非安全上下文（缺 randomUUID）下用 getRandomValues 手工拼出 v4', () => {
    replaceWebCrypto({
      getRandomValues: (array: Uint8Array): Uint8Array => {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = index;
        }
        return array;
      },
    });

    const id = createRandomUuid();

    expect(id).toMatch(UUID_V4_PATTERN);
    // 第 6 字节 0x06 → 0x46（版本 4），第 8 字节 0x08 → 0x88（变体 1）。
    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('crypto 完全不可用时退化为伪随机，仍满足 v4 形状', () => {
    replaceWebCrypto(undefined);

    const ids = new Set([createRandomUuid(), createRandomUuid(), createRandomUuid()]);

    for (const id of ids) {
      expect(id).toMatch(UUID_V4_PATTERN);
    }
    expect(ids.size).toBe(3);
  });
});
