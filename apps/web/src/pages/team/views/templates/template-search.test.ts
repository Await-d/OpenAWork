/**
 * templateSearchHaystack 搜索文本组装测试。
 */

import { describe, expect, it } from 'vitest';
import type { WorkflowTemplateRecord } from '@openAwork/web-client';
import { compareByUsagePreference, templateSearchHaystack } from './TemplateListSidebar.js';

function makeTemplate(overrides: Partial<WorkflowTemplateRecord> = {}): WorkflowTemplateRecord {
  return {
    id: 't1',
    name: '完整开发团队',
    description: '复杂功能开发闭环',
    category: 'team-playbook',
    nodes: [],
    edges: [],
    metadata: {
      teamTemplate: {
        templateFocus: '全流程交付',
        recommendedFor: '跨模块需求',
        memberSlots: [
          {
            id: 'executor-frontend',
            layer: 'executor',
            specialty: 'frontend',
            displayName: '前端开发者',
            personaKey: 'executor:frontend',
            toolsets: ['read'],
            required: true,
          },
        ],
      },
    },
    ...overrides,
  } as WorkflowTemplateRecord;
}

describe('templateSearchHaystack', () => {
  it('包含名称 / 描述 / 重点 / 适用场景 / 成员名，且小写化', () => {
    const hay = templateSearchHaystack(makeTemplate());
    expect(hay).toContain('完整开发团队');
    expect(hay).toContain('复杂功能开发闭环');
    expect(hay).toContain('全流程交付');
    expect(hay).toContain('跨模块需求');
    expect(hay).toContain('前端开发者');
  });

  it('英文统一小写便于不区分大小写匹配', () => {
    const hay = templateSearchHaystack(makeTemplate({ name: 'GPT Team' }));
    expect(hay).toContain('gpt team');
  });

  it('缺字段时不抛错', () => {
    const hay = templateSearchHaystack(
      makeTemplate({ description: null, metadata: undefined } as Partial<WorkflowTemplateRecord>),
    );
    expect(typeof hay).toBe('string');
    expect(hay).toContain('完整开发团队');
  });
});

describe('compareByUsagePreference', () => {
  const a = makeTemplate({ id: 'a', name: 'A' });
  const b = makeTemplate({ id: 'b', name: 'B' });

  it('最近使用时间更近者排前', () => {
    const recent = { a: 100, b: 200 };
    expect(compareByUsagePreference(a, b, recent, {})).toBeGreaterThan(0); // b 在前
    expect(compareByUsagePreference(b, a, recent, {})).toBeLessThan(0);
  });

  it('最近时间相同时按使用次数多者排前', () => {
    const usage = { a: 1, b: 5 };
    expect(compareByUsagePreference(a, b, {}, usage)).toBeGreaterThan(0); // b 在前
  });

  it('最近优先级高于使用次数', () => {
    // a 最近用过但次数少；b 没最近记录但次数多 → a 应排前
    const recent = { a: 999 };
    const usage = { a: 1, b: 50 };
    expect(compareByUsagePreference(a, b, recent, usage)).toBeLessThan(0); // a 在前
  });

  it('都无统计时返回 0（维持原次序）', () => {
    expect(compareByUsagePreference(a, b, {}, {})).toBe(0);
    expect(compareByUsagePreference(a, b, undefined, undefined)).toBe(0);
  });

  it('用于 Array.sort 时常用模板上浮', () => {
    const c = makeTemplate({ id: 'c', name: 'C' });
    const recent = { b: 300 };
    const usage = { c: 9 };
    // b 最近用过 → 最前；c 用得多 → 次之；a 无记录 → 最后
    const sorted = [a, c, b].sort((x, y) => compareByUsagePreference(x, y, recent, usage));
    expect(sorted.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
});
