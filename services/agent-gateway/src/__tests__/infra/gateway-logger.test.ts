/**
 * `describeError` 的行为契约。
 *
 * 重点是「记录错误的过程本身绝不能抛出」：这些函数在 catch 块里被调用，
 * 一旦抛出就会用新的异常覆盖真正的故障现场，比不记录更糟。
 */
import { describe, expect, it } from 'vitest';
import { describeError } from '../../infra/gateway-logger.js';

describe('describeError', () => {
  it('Error 实例保留名称、消息与堆栈', () => {
    const described = describeError(new TypeError('响应解析失败'));
    expect(described.errorName).toBe('TypeError');
    expect(described.errorMessage).toBe('响应解析失败');
    expect(described.errorStack).toContain('TypeError');
  });

  it('超长堆栈被截断，避免单条日志吞掉整个日志管道', () => {
    const described = describeError(new Error('x'.repeat(50_000)));
    expect(described.errorStack?.length).toBeLessThanOrEqual(8_000);
  });

  it('字符串直接作为消息', () => {
    expect(describeError('网关连接中断').errorMessage).toBe('网关连接中断');
  });

  it('对象抛出值序列化为 JSON 而非 [object Object]', () => {
    const described = describeError({ code: 'E_UPSTREAM', status: 502 });
    expect(described.errorMessage).toContain('E_UPSTREAM');
    expect(described.errorMessage).not.toContain('[object Object]');
  });

  it('循环引用不抛错', () => {
    const circular: Record<string, unknown> = { code: 'E_LOOP' };
    circular['self'] = circular;
    expect(() => describeError(circular)).not.toThrow();
    expect(describeError(circular).errorMessage).toBe('object');
  });

  it('Symbol 不抛错——String(Symbol) 会直接抛 TypeError', () => {
    expect(() => describeError(Symbol('boom'))).not.toThrow();
    expect(describeError(Symbol('boom')).errorMessage).toBe('symbol');
  });

  it('undefined / null 退化为类型名而非空串', () => {
    expect(describeError(undefined).errorMessage).toBe('undefined');
    expect(describeError(null).errorMessage).toBe('null');
  });
});
