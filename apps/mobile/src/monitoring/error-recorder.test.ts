/**
 * 移动端错误记录中枢的行为契约。
 *
 * 守护目标很直接：客户端出的错一定要留下可排查的痕迹，且记录动作本身绝不能抛错
 * （这些函数全在 catch 路径上，一旦抛出就会用新异常覆盖真正的故障现场）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  describeMobileError,
  mobileErrorRecorder,
  redactSensitive,
  recordMobileError,
} from './error-recorder';

describe('redactSensitive', () => {
  it('抹掉 Bearer 令牌', () => {
    expect(redactSensitive('Authorization: Bearer abc.def-123')).not.toContain('abc.def-123');
  });

  it('抹掉 token / password 字段', () => {
    const text = '{"token":"secret-value","password":"hunter2"}';
    const result = redactSensitive(text);
    expect(result).not.toContain('secret-value');
    expect(result).not.toContain('hunter2');
  });

  it('无敏感信息时原样返回', () => {
    expect(redactSensitive('会话加载失败')).toBe('会话加载失败');
  });
});

describe('describeMobileError', () => {
  it('Error 保留名称、消息与堆栈', () => {
    const described = describeMobileError(new TypeError('渲染失败'));
    expect(described.name).toBe('TypeError');
    expect(described.message).toBe('渲染失败');
    expect(described.stack).toContain('TypeError');
  });

  it('对象抛出值序列化为 JSON 而非 [object Object]', () => {
    expect(describeMobileError({ code: 'E_NET' }).message).toContain('E_NET');
  });

  it('Symbol 不抛错（String(Symbol) 会直接抛 TypeError）', () => {
    expect(() => describeMobileError(Symbol('x'))).not.toThrow();
  });

  it('循环引用不抛错', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => describeMobileError(circular)).not.toThrow();
  });

  it('undefined 退化为类型名而非空串', () => {
    expect(describeMobileError(undefined).message).toBe('undefined');
  });
});

describe('mobileErrorRecorder', () => {
  beforeEach(() => {
    mobileErrorRecorder.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('记录后可在导出文本中检索到', () => {
    recordMobileError(new Error('网关连接超时'), { action: 'refresh' });
    const text = mobileErrorRecorder.toText();
    expect(text).toContain('网关连接超时');
    expect(text).toContain('refresh');
  });

  it('无记录时导出占位文案', () => {
    expect(mobileErrorRecorder.toText()).toContain('未捕获到客户端错误');
  });

  it('上下文中的敏感信息在入库前已脱敏', () => {
    recordMobileError(new Error('上传失败'), { header: 'Bearer sk-live-abcdef' });
    expect(mobileErrorRecorder.toText()).not.toContain('sk-live-abcdef');
  });

  it('订阅者抛错不影响记录落库', () => {
    const unsubscribe = mobileErrorRecorder.subscribe(() => {
      throw new Error('sink 挂了');
    });
    expect(() => recordMobileError(new Error('真实故障'))).not.toThrow();
    expect(mobileErrorRecorder.count()).toBe(1);
    unsubscribe();
  });

  it('取消订阅后不再收到通知', () => {
    const sink = vi.fn();
    const unsubscribe = mobileErrorRecorder.subscribe(sink);
    recordMobileError(new Error('A'));
    unsubscribe();
    recordMobileError(new Error('B'));
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('超过容量时丢弃最旧记录', () => {
    for (let i = 0; i < 120; i += 1) {
      recordMobileError(new Error(`错误${i}`));
    }
    expect(mobileErrorRecorder.count()).toBe(100);
    expect(mobileErrorRecorder.list()[0]?.message).not.toBe('错误0');
  });

  it('渲染边界来源被正确标注', () => {
    const record = recordMobileError(new Error('渲染崩了'), undefined, 'react-boundary');
    expect(record.source).toBe('react-boundary');
    expect(console.error).toHaveBeenCalled();
  });
});
