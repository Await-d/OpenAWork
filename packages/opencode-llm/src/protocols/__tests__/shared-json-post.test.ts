/**
 * `jsonPost` 请求编码契约测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 D-B：`encoding` 为 `zstd`/`gzip` 时压缩正文并声明 `content-encoding`；
 * 未指定或 `none` 时保持纯 JSON（运行时无 zlib 时同样退化为纯 JSON）。
 */

import { describe, it, expect } from 'vitest';
import { Option } from 'effect';
import { Headers } from 'effect/http';
import * as ProviderShared from '../shared.js';

const contentEncoding = (encoding?: 'zstd' | 'gzip' | 'none') =>
  Option.getOrUndefined(
    Headers.get('content-encoding')(
      ProviderShared.jsonPost({
        url: 'https://example.test/v1/messages',
        body: '{"a":1}',
        encoding,
      }).headers,
    ),
  );

describe('jsonPost', () => {
  it('未指定 encoding 时不压缩', () => {
    expect(contentEncoding()).toBeUndefined();
  });

  it('encoding: none 时不压缩', () => {
    expect(contentEncoding('none')).toBeUndefined();
  });

  it('gzip 时声明 content-encoding', () => {
    expect(contentEncoding('gzip')).toBe('gzip');
  });

  it('zstd 时声明 content-encoding', () => {
    expect(contentEncoding('zstd')).toBe('zstd');
  });

  it('gzip 后的正文仍声明 JSON 内容类型', () => {
    const request = ProviderShared.jsonPost({
      url: 'https://example.test/v1/messages',
      body: '{"a":1}',
      encoding: 'gzip',
    });

    expect(Option.getOrUndefined(Headers.get('content-type')(request.headers))).toBe(
      'application/json',
    );
  });
});
