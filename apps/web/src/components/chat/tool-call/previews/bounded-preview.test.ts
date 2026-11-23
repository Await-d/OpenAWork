import { describe, expect, it, vi } from 'vitest';
import { boundedJson, previewKeys } from './bounded-preview.js';

describe('有界序列化', () => {
  it('小型 JSON 数据保留 stringify 格式，包括跨分块的 Unicode', () => {
    const data = {
      text: `${'a'.repeat(255)}😀end`,
      nested: [true, null, { count: 3 }],
      omitted: undefined,
    };
    expect(boundedJson(data, 20_000)).toEqual({
      text: JSON.stringify(data, null, 2),
      clipped: false,
    });
  });

  it('未序列化的 undefined 字段也消耗遍历预算', () => {
    const read = vi.fn(() => undefined);
    const data = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, undefined]));
    Object.defineProperty(data, 'tail', { enumerable: true, get: read });
    expect(boundedJson(data, 100).clipped).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('字段枚举不调用 getter，并忽略继承字段', () => {
    const read = vi.fn(() => 'value');
    const data: object = Object.create({ inherited: 1 });
    Object.defineProperty(data, 'own', { enumerable: true, get: read });
    expect(previewKeys(data, 1)).toEqual({ keys: ['own'], more: false });
    expect(read).not.toHaveBeenCalled();
  });
});
