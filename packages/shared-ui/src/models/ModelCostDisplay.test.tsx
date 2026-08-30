import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelCostDisplay } from './ModelCostDisplay.js';

describe('ModelCostDisplay', () => {
  it('分别展示缓存读取与缓存写入单价', () => {
    const markup = renderToStaticMarkup(
      createElement(ModelCostDisplay, {
        modelName: 'claude-sonnet',
        inputPer1m: 3,
        outputPer1m: 15,
        cacheReadPer1m: 0.3,
        cacheWritePer1m: 3.75,
      }),
    );

    expect(markup).toContain('缓存读取');
    expect(markup).toContain('缓存写入');
    expect(markup).toContain('$0.30/1M cached');
    expect(markup).toContain('$3.75/1M cached');
  });

  it('保留旧 cachedPer1m 调用方的展示兼容性', () => {
    const markup = renderToStaticMarkup(
      createElement(ModelCostDisplay, {
        modelName: 'legacy-model',
        inputPer1m: 1,
        outputPer1m: 2,
        cachedPer1m: 0.1,
      }),
    );

    expect(markup).toContain('缓存');
    expect(markup).not.toContain('缓存读取');
    expect(markup).not.toContain('缓存写入');
  });
});
