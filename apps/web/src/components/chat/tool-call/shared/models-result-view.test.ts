import { describe, expect, it } from 'vitest';

import { buildModelsResultViews } from './models-result-view.js';

/** 形状对齐 `ModelSearchOutput`（`tools/model-search-tools.ts`）。 */
const OUTPUT = {
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [
        {
          id: 'anthropic/claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          released: 1759190400000,
          variants: [],
          cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
          status: 'active',
        },
        {
          id: 'anthropic/claude-3-5-haiku',
          name: 'Claude 3.5 Haiku',
          // 网关的 parseReleased() 解析失败时返回 0
          released: 0,
          variants: [],
          cost: [{ input: 0.8, output: 4, cache: { read: 0.08, write: 1 } }],
          status: 'deprecated',
        },
      ],
    },
  ],
  total: 42,
  next: 20,
};

describe('buildModelsResultViews', () => {
  it('按 provider 分组，并把总数与分页说清楚', () => {
    const views = buildModelsResultViews(OUTPUT);

    expect(views?.primary.note).toBe('共 42 个模型，显示前 2 个');
    expect(views?.primary.groups?.[0]?.label).toBe('Anthropic');
    expect(views?.primary.groups?.[0]?.count).toBe(2);
    expect(views?.primary.footnote).toContain('offset');
  });

  it('cost 是数组——取首元素，当对象读会丢掉全部定价', () => {
    const views = buildModelsResultViews(OUTPUT);

    expect(views?.primary.groups?.[0]?.rows[0]?.trailing).toBe('$3 / $15');
  });

  it('released 为 0 视为未知，不会渲染成 1970 年', () => {
    const views = buildModelsResultViews(OUTPUT);
    const haiku = views?.primary.groups?.[0]?.rows[1];

    expect(haiku?.meta?.some((item) => item.includes('1970'))).toBe(false);
    expect(haiku?.meta?.some((item) => item.includes('发布'))).toBe(false);
  });

  it('deprecated 标成「已停用」（语义是账号下被停用，不是官方下线）', () => {
    const views = buildModelsResultViews(OUTPUT);

    expect(views?.primary.groups?.[0]?.rows[0]?.badges?.[0]?.label).toBe('可用');
    expect(views?.primary.groups?.[0]?.rows[1]?.badges?.[0]?.label).toBe('已停用');
  });

  it('表格视图列对齐，便于比价', () => {
    const views = buildModelsResultViews(OUTPUT);

    expect(views?.alternate.table?.columns).toEqual([
      '模型',
      '状态',
      '输入 / M',
      '输出 / M',
      '缓存读',
      '发布',
      'Provider',
    ]);
    expect(views?.alternate.table?.rows[0]?.[2]?.text).toBe('$3');
    expect(views?.alternate.table?.rows[0]?.[4]?.text).toBe('$0.3');
  });

  it('provider 既没有 id 也没有 name 时给占位标题，而不是空分组', () => {
    // 曾经 `id` 先被兜成 `''`，`''` 不是 nullish，`?? '未命名 Provider'` 永远走不到，
    // 分组标题会渲染成空白。
    const views = buildModelsResultViews({
      providers: [{ models: [{ id: 'x/y', name: 'Y' }] }],
      total: 1,
      next: null,
    });

    expect(views?.primary.groups?.[0]?.label).toBe('未命名 Provider');
  });

  it('不是模型目录时返回 null', () => {
    expect(buildModelsResultViews({ providers: [] })).toBeNull();
    expect(buildModelsResultViews({ providers: 'x' })).toBeNull();
    expect(buildModelsResultViews({ providers: [{ models: 'x' }] })).toBeNull();
    expect(buildModelsResultViews(null)).toBeNull();
  });
});
