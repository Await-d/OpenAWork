/**
 * schema/options 契约单元测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-05 新增的 HTTP 超时契约、请求体编码契约、缓存格式声明，
 * 以及 CachePolicyObject 的 tail 取值约束。
 */

import { describe, it, expect } from 'vitest';
import { Schema } from 'effect';
import {
  CachePolicyObject,
  DEFAULT_CHUNK_TIMEOUT_MS,
  DEFAULT_HTTP_TIMEOUT_MS,
  HttpOptions,
  HttpTimeout,
  ModelCompatibility,
  RequestEncoding,
  mergeHttpOptions,
} from '../options.js';

const decodeHttpTimeout = Schema.decodeUnknownSync(HttpTimeout);
const decodeRequestEncoding = Schema.decodeUnknownSync(RequestEncoding);
const decodeCompatibility = Schema.decodeUnknownSync(ModelCompatibility);
const decodeCachePolicyObject = Schema.decodeUnknownSync(CachePolicyObject);

describe('HttpTimeout', () => {
  it('接受正毫秒数', () => {
    expect(decodeHttpTimeout(5000)).toBe(5000);
  });

  it('接受 false 表示显式关闭该超时', () => {
    expect(decodeHttpTimeout(false)).toBe(false);
  });

  it('拒绝 0 与负数', () => {
    expect(() => decodeHttpTimeout(0)).toThrow();
    expect(() => decodeHttpTimeout(-1)).toThrow();
  });
});

describe('默认超时常量', () => {
  it('响应头默认 5 分钟、流式分片默认 15 分钟', () => {
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(300_000);
    expect(DEFAULT_CHUNK_TIMEOUT_MS).toBe(900_000);
  });
});

describe('RequestEncoding', () => {
  it('接受 zstd / gzip / none', () => {
    for (const value of ['zstd', 'gzip', 'none'] as const) {
      expect(decodeRequestEncoding(value)).toBe(value);
    }
  });

  it('拒绝未知编码', () => {
    expect(() => decodeRequestEncoding('br')).toThrow();
  });
});

describe('HttpOptions', () => {
  it('make(undefined) 保持 undefined', () => {
    expect(HttpOptions.make(undefined)).toBeUndefined();
  });

  it('make 幂等：传入实例时返回同一实例', () => {
    const options = HttpOptions.make({ timeout: 1000 });
    expect(HttpOptions.make(options)).toBe(options);
  });

  it('mergeHttpOptions 对超时与编码取最后一个已定义值', () => {
    const merged = mergeHttpOptions(
      new HttpOptions({ timeout: 1000, encoding: 'gzip', headers: { a: '1' } }),
      new HttpOptions({ timeout: 2000, chunkTimeout: 3000 }),
    );
    expect(merged?.timeout).toBe(2000);
    expect(merged?.chunkTimeout).toBe(3000);
    expect(merged?.encoding).toBe('gzip');
    expect(merged?.headers).toEqual({ a: '1' });
    expect(merged?.headerTimeout).toBeUndefined();
  });

  it('mergeHttpOptions 支持 false 关闭超时（不被当作未设置）', () => {
    const merged = mergeHttpOptions(
      new HttpOptions({ timeout: 1000 }),
      new HttpOptions({ timeout: false }),
    );
    expect(merged?.timeout).toBe(false);
  });

  it('mergeHttpOptions 无任何字段时返回 undefined', () => {
    expect(mergeHttpOptions(undefined, new HttpOptions({}))).toBeUndefined();
  });
});

describe('ModelCompatibility.cacheFormat', () => {
  it('接受 anthropic / alibaba', () => {
    expect(decodeCompatibility({ cacheFormat: 'anthropic' }).cacheFormat).toBe('anthropic');
    expect(decodeCompatibility({ cacheFormat: 'alibaba' }).cacheFormat).toBe('alibaba');
  });

  it('拒绝未知缓存格式', () => {
    expect(() => decodeCompatibility({ cacheFormat: 'openai' })).toThrow();
  });

  it('未声明时保持 undefined', () => {
    expect(decodeCompatibility({}).cacheFormat).toBeUndefined();
  });
});

describe('CachePolicyObject.messages.tail', () => {
  it('接受非负整数', () => {
    expect(decodeCachePolicyObject({ messages: { tail: 0 } })).toEqual({ messages: { tail: 0 } });
    expect(decodeCachePolicyObject({ messages: { tail: 3 } })).toEqual({ messages: { tail: 3 } });
  });

  it('拒绝负数与非整数', () => {
    expect(() => decodeCachePolicyObject({ messages: { tail: -1 } })).toThrow();
    expect(() => decodeCachePolicyObject({ messages: { tail: 1.5 } })).toThrow();
  });
});
