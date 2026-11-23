/**
 * stream-error-content-unified.test.ts — 钉住「同一错误在两条路径落库内容一致」的语义。
 *
 * 背景（2026-11-04 修复的真实不一致）：
 * - 模型轮次路径（`stream-model-round.ts`，`:1961` / `:2158`）曾用一份**三参**
 *   `buildErrorContent`，正文追加 `\n\n技术详情：{detail}`；
 * - 顶层路径（`stream.ts:3088`）用 `stream-error-handler.ts` 的**两参**版本，只出
 *   `[错误: CODE] 摘要`；
 * → 同一个 `STREAM_ERROR` 用户可见内容不同（前者带技术详情折叠区，后者没有）。
 *
 * 正确处理：把三参版提升为**唯一真相源**（`stream-error-handler.ts`），轮次路径改为
 * 转发该实现，顶层路径补传技术详情位。前端 `assistant-error-content-v2` 依赖
 * `\n\n技术详情：` 字面标记还原折叠区，形态必须一致。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildErrorContent } from '../../routes/stream-error-handler.js';

const ERRORS_DIR = new URL('../../routes/', import.meta.url);

function readRouteSource(fileName: string): string {
  return readFileSync(new URL(fileName, ERRORS_DIR), 'utf8');
}

describe('错误正文构造的唯一真相源', () => {
  it('两参调用只产出 `[错误: CODE] 摘要`', () => {
    expect(buildErrorContent('STREAM_ERROR', '连接失败')).toEqual([
      { type: 'text', text: '[错误: STREAM_ERROR] 连接失败' },
    ]);
  });

  it('第三参（技术详情）追加 `\\n\\n技术详情：` 后缀，且与摘要相同时不重复', () => {
    expect(buildErrorContent('V2_UPSTREAM_ERROR', '上游不可用', 'ECONNRESET')).toEqual([
      { type: 'text', text: '[错误: V2_UPSTREAM_ERROR] 上游不可用\n\n技术详情：ECONNRESET' },
    ]);
    expect(buildErrorContent('STREAM_ERROR', '连接失败', '连接失败')).toEqual([
      { type: 'text', text: '[错误: STREAM_ERROR] 连接失败' },
    ]);
  });
});

describe('两条路径共用同一实现（源码级钉住）', () => {
  it('stream-model-round.ts 不再自定义 buildErrorContent，而是从 error-handler 导入', () => {
    const source = readRouteSource('stream-model-round.ts');
    // 转发语句存在
    expect(source).toMatch(
      /import\s*\{\s*buildErrorContent\s*\}\s*from\s*'\.\/stream-error-handler\.js'/,
    );
    // 本地实现（函数声明）已撤除
    expect(source).not.toMatch(/function\s+buildErrorContent\s*\(/);
  });

  it('顶层 stream.ts 的 STREAM_ERROR 落库调用带第三参（与轮次路径同形）', () => {
    const source = readRouteSource('stream.ts');
    expect(source).toMatch(
      /buildErrorContent\('STREAM_ERROR', streamErrorDetail\.errorMessage, err\)/,
    );
  });

  it('轮次路径的 STREAM_ERROR / V2_UPSTREAM_ERROR 仍带技术详情位', () => {
    const roundSource = readRouteSource('stream-model-round.ts');
    expect(roundSource).toMatch(/buildErrorContent\('V2_UPSTREAM_ERROR', [\w.]+, [\w.]+\)/);
    expect(roundSource).toMatch(/buildErrorContent\('STREAM_ERROR', [\w.]+, [\w.]+\)/);
  });
});
