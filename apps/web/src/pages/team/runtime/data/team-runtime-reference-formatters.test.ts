import { describe, expect, it } from 'vitest';
import { formatTimelineDetail } from './team-runtime-reference-formatters.js';

describe('formatTimelineDetail 不再退化成裸 JSON 括号', () => {
  it('嵌套对象给出键名摘要而不是 {', () => {
    const result = formatTimelineDetail(JSON.stringify({ foo: { bar: 1 } }, null, 2));
    expect(result).not.toBe('{');
    expect(result).toBe('字段：foo');
  });

  it('对象数组给出键名摘要而不是 [', () => {
    const result = formatTimelineDetail(JSON.stringify([{ foo: { bar: 1 } }], null, 2));
    expect(result).not.toBe('[');
    expect(result).toBe('字段：foo');
  });

  it('基本类型数组给出项数摘要', () => {
    const result = formatTimelineDetail(JSON.stringify([1, 2, 3], null, 2));
    expect(result).not.toBe('[');
    expect(result).toBe('数组（3 项）');
  });

  it('空对象不会退化成 {', () => {
    expect(formatTimelineDetail(JSON.stringify({}, null, 2))).not.toBe('{');
  });

  it('保留原有可读字段提取', () => {
    expect(
      formatTimelineDetail(JSON.stringify({ action: 'create', subject: '任务A' }, null, 2)),
    ).toBe('创建：任务A');
  });

  it('普通多行文本仍取首行', () => {
    expect(formatTimelineDetail('第一行\n第二行')).toBe('第一行');
  });
});
