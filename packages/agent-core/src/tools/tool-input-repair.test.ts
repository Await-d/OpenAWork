import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { repairToolInput } from './tool-input-repair.js';
import { ToolRegistry, ToolValidationError } from './tool-contract.js';

describe('repairToolInput', () => {
  describe('字符串化 JSON → object', () => {
    it('解析目标是对象时的 JSON 字符串', () => {
      const schema = z.object({ limit: z.number() });
      expect(repairToolInput(schema, '{"limit":20}')).toEqual({ limit: 20 });
    });

    it('不以 { 开头的普通字符串保持原样', () => {
      const schema = z.object({ limit: z.number() });
      expect(repairToolInput(schema, 'not json')).toBe('not json');
    });

    it('已经是对象时不改动（返回同一引用）', () => {
      const schema = z.object({ limit: z.number() });
      const input = { limit: 20 };
      expect(repairToolInput(schema, input)).toBe(input);
    });
  });

  describe('数字字符串 → number', () => {
    it('把嵌套的数字字符串转成数字', () => {
      const schema = z.object({ limit: z.number() });
      expect(repairToolInput(schema, { limit: '20' })).toEqual({ limit: 20 });
    });

    it('非数字字符串保持原样', () => {
      const schema = z.object({ limit: z.number() });
      expect(repairToolInput(schema, { limit: 'abc' })).toEqual({ limit: 'abc' });
    });

    it('整数字符串的小数形式不被转换', () => {
      const schema = z.object({ limit: z.number().int() });
      expect(repairToolInput(schema, { limit: '2.5' })).toEqual({ limit: '2.5' });
    });
  });

  describe('布尔字符串 → boolean', () => {
    it('把 "true" / "false" 转成布尔值', () => {
      const schema = z.object({ enabled: z.boolean() });
      expect(repairToolInput(schema, { enabled: 'true' })).toEqual({ enabled: true });
      expect(repairToolInput(schema, { enabled: 'false' })).toEqual({ enabled: false });
    });

    it('其他字符串保持原样', () => {
      const schema = z.object({ enabled: z.boolean() });
      expect(repairToolInput(schema, { enabled: 'yes' })).toEqual({ enabled: 'yes' });
    });
  });

  describe('不对 string 做类型强转（对齐上游）', () => {
    it('数字 / 布尔不会转成字符串', () => {
      const schema = z.object({ path: z.string() });
      expect(repairToolInput(schema, { path: 123 })).toEqual({ path: 123 });
      expect(repairToolInput(schema, { path: true })).toEqual({ path: true });
    });

    it('字符串本身保持原样', () => {
      const schema = z.object({ path: z.string() });
      expect(repairToolInput(schema, { path: '123' })).toEqual({ path: '123' });
      expect(repairToolInput(schema, { path: 'true' })).toEqual({ path: 'true' });
    });
  });

  describe('严格对象删除未声明键', () => {
    it('.strict() 下的多余键被删除', () => {
      const schema = z.object({ limit: z.number() }).strict();
      expect(repairToolInput(schema, { limit: '20', extra: true })).toEqual({ limit: 20 });
    });

    it('z.strictObject() 同样删除多余键', () => {
      const schema = z.strictObject({ limit: z.number() });
      expect(repairToolInput(schema, { limit: 20, extra: true })).toEqual({ limit: 20 });
    });

    it('strip / passthrough 保留多余键', () => {
      const strip = z.object({ limit: z.number() });
      expect(repairToolInput(strip, { limit: 20, extra: true })).toEqual({
        limit: 20,
        extra: true,
      });
      const pass = z.object({ limit: z.number() }).passthrough();
      expect(repairToolInput(pass, { limit: 20, extra: true })).toEqual({
        limit: 20,
        extra: true,
      });
    });

    it('catchall 存在时不删除多余键', () => {
      const schema = z.object({ limit: z.number() }).catchall(z.unknown());
      expect(repairToolInput(schema, { limit: 20, extra: true })).toEqual({
        limit: 20,
        extra: true,
      });
    });

    it('catchall schema 会用于修复未声明键的值（对齐上游 additionalProperties）', () => {
      const schema = z.object({ limit: z.number() }).catchall(z.number());
      expect(repairToolInput(schema, { limit: 20, extra: '30' })).toEqual({
        limit: 20,
        extra: 30,
      });
    });
  });

  describe('非必填占位符清理', () => {
    it('非必填字段的 null 占位被删除', () => {
      const schema = z.object({ limit: z.number().optional(), keep: z.string() });
      expect(repairToolInput(schema, { limit: null, keep: 'x' })).toEqual({ keep: 'x' });
    });

    it('非必填字段的空对象占位被删除', () => {
      const schema = z.object({ tags: z.array(z.string()).optional() });
      expect(repairToolInput(schema, { tags: {} })).toEqual({});
    });

    it('必填字段的 null 保持原样', () => {
      const schema = z.object({ limit: z.number() });
      expect(repairToolInput(schema, { limit: null })).toEqual({ limit: null });
    });

    it('nullable 字段的 null 保持原样（null 合法）', () => {
      const schema = z.object({ limit: z.number().nullable() });
      expect(repairToolInput(schema, { limit: null })).toEqual({ limit: null });
    });

    it('object / record 目标的空对象保持原样', () => {
      const schema = z.object({ config: z.object({ a: z.number() }).optional() });
      expect(repairToolInput(schema, { config: {} })).toEqual({ config: {} });
    });
  });

  describe('字符串化数组 / 单元素 → array', () => {
    it('解析目标是数组时的 JSON 字符串', () => {
      const schema = z.object({ tags: z.array(z.string()) });
      expect(repairToolInput(schema, { tags: '["a","b"]' })).toEqual({ tags: ['a', 'b'] });
    });

    it('单个兼容元素被包装为单元素数组', () => {
      const schema = z.object({ counts: z.array(z.number()) });
      expect(repairToolInput(schema, { counts: '2' })).toEqual({ counts: [2] });
    });

    it('与元素 schema 不兼容时保持原样', () => {
      const schema = z.object({ items: z.array(z.object({ a: z.number() })) });
      const input = { items: 'hello' };
      expect(repairToolInput(schema, input)).toBe(input);
    });
  });

  describe('nullable / optional 包装递归', () => {
    it('nullable 字段内部继续修复', () => {
      const schema = z.object({ count: z.number().nullable() });
      expect(repairToolInput(schema, { count: '2' })).toEqual({ count: 2 });
    });

    it('optional 字段内部继续修复', () => {
      const schema = z.object({ enabled: z.boolean().optional() });
      expect(repairToolInput(schema, { enabled: 'true' })).toEqual({ enabled: true });
    });

    it('null / undefined 不被改写', () => {
      const schema = z.object({ count: z.number().nullable(), note: z.string().optional() });
      expect(repairToolInput(schema, { count: null })).toEqual({ count: null });
      expect(repairToolInput(schema, {})).toEqual({});
    });
  });

  describe('嵌套结构', () => {
    it('递归修复嵌套对象与数组元素', () => {
      const schema = z.object({
        items: z.array(z.object({ count: z.number(), label: z.string() })),
      });
      expect(repairToolInput(schema, { items: [{ count: '2', label: 3 }] })).toEqual({
        items: [{ count: 2, label: 3 }],
      });
    });

    it('嵌套对象本身是字符串化 JSON 时先解析', () => {
      const schema = z.object({ nested: z.object({ count: z.number() }) });
      expect(repairToolInput(schema, { nested: '{"count":"2"}' })).toEqual({
        nested: { count: 2 },
      });
    });
  });

  describe('tuple 与 record', () => {
    it('按位置修复 tuple 成员', () => {
      const schema = z.object({ pair: z.tuple([z.number(), z.boolean()]) });
      expect(repairToolInput(schema, { pair: ['2', 'false'] })).toEqual({ pair: [2, false] });
    });

    it('修复 record 的每个 value', () => {
      const schema = z.object({ counts: z.record(z.number()) });
      expect(repairToolInput(schema, { counts: { first: '2', second: 3 } })).toEqual({
        counts: { first: 2, second: 3 },
      });
    });
  });

  describe('union', () => {
    it('nullable union 在唯一候选下修复', () => {
      const schema = z.object({ count: z.union([z.number(), z.null()]) });
      expect(repairToolInput(schema, { count: '2' })).toEqual({ count: 2 });
    });

    it('多候选且无法判断时保持原样', () => {
      const schema = z.object({ value: z.union([z.string(), z.number()]) });
      const input = { value: 'abc' };
      expect(repairToolInput(schema, input)).toBe(input);
    });
  });

  describe('effects（refine / superRefine / transform）', () => {
    it('refine 包装的对象仍能修复内部字段', () => {
      const schema = z
        .object({ limit: z.number() })
        .refine((value) => value.limit > 0, { message: 'limit 必须为正' });
      expect(repairToolInput(schema, { limit: '20' })).toEqual({ limit: 20 });
    });

    it('superRefine 包装的 discriminatedUnion 仍能递归进成员', () => {
      const schema = z
        .discriminatedUnion('action', [
          z.object({ action: z.literal('click'), x: z.number(), y: z.number() }),
          z.object({ action: z.literal('wait'), ms: z.number() }),
        ])
        .superRefine(() => {
          // 校验逻辑与修复无关，这里只需非空实现。
        });
      expect(repairToolInput(schema, { action: 'click', x: '1', y: '2' })).toEqual({
        action: 'click',
        x: 1,
        y: 2,
      });
    });

    it('transform 包装的输入侧 schema 被拆开修复', () => {
      const schema = z.object({ limit: z.number() }).transform((value) => value.limit);
      expect(repairToolInput(schema, { limit: '20' })).toEqual({ limit: 20 });
    });
  });

  describe('不确定就不改', () => {
    it('未知 schema 原样返回', () => {
      const input = { anything: 1 };
      expect(repairToolInput(z.any(), input)).toBe(input);
    });

    it('已经是正确类型时不产生新对象', () => {
      const schema = z.object({ limit: z.number(), names: z.array(z.string()) });
      const input = { limit: 20, names: ['a'] };
      expect(repairToolInput(schema, input)).toBe(input);
    });

    it('对非法 JSON 字符串不抛异常且原样返回', () => {
      const schema = z.object({ limit: z.number() });
      const input = { limit: '{broken' };
      expect(() => repairToolInput(schema, input)).not.toThrow();
      expect(repairToolInput(schema, input)).toBe(input);
    });
  });
});

describe('ToolRegistry 集成', () => {
  it('模型给出字符串化 JSON 时，修复后能通过校验', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'sum',
      description: 'sum numbers',
      inputSchema: z.object({ left: z.number(), right: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      execute: async ({ left, right }) => ({ value: left + right }),
    });

    const result = await registry.execute(
      { toolCallId: 'call-repair', toolName: 'sum', rawInput: '{"left":2,"right":3}' },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      toolCallId: 'call-repair',
      output: { value: 5 },
      isError: false,
    });
  });

  it('无法修复的输入仍然按原样报校验错误', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'read',
      description: 'read',
      inputSchema: z.object({ path: z.string().min(1) }),
      outputSchema: z.string(),
      execute: async ({ path }) => path,
    });

    await expect(
      registry.execute(
        { toolCallId: 'invalid', toolName: 'read', rawInput: { path: '' } },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});
