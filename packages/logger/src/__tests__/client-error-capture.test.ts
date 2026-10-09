/**
 * 客户端错误记录器的行为契约。
 *
 * 守护的是「客户端错误一定要留下可排查的痕迹」：丢记录、去重过度、丢失堆栈
 * 都会让排障退回「让用户复述一下刚才发生了什么」。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ClientErrorRecorder,
  describeClientError,
  installGlobalErrorCapture,
} from '../client-error-capture.js';

describe('describeClientError', () => {
  it('保留 Error 的堆栈', () => {
    const described = describeClientError(new TypeError('字段缺失'));
    expect(described.name).toBe('TypeError');
    expect(described.message).toBe('字段缺失');
    expect(described.stack).toContain('TypeError');
  });

  it('区分无参 rejection，不产出空消息', () => {
    expect(describeClientError(undefined).message).toBe('undefined');
    expect(describeClientError(null).message).toBe('null');
  });

  it('对象 rejection 也能提取出可读信息', () => {
    const described = describeClientError({ code: 'E_UNKNOWN', message: '网关未响应' });
    expect(described.message).toBe('网关未响应');
  });

  it('无法序列化的循环引用不会抛出', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => describeClientError(circular)).not.toThrow();
  });
});

describe('ClientErrorRecorder', () => {
  it('记录后可通过 toText 导出完整诊断信息', () => {
    const recorder = new ClientErrorRecorder();
    recorder.record({ source: 'uncaught', error: new Error('渲染失败') });

    const text = recorder.toText();
    expect(text).toContain('渲染失败');
    expect(text).toContain('uncaught');
    expect(recorder.count()).toBe(1);
  });

  it('无错误时导出占位文案而非空串', () => {
    expect(new ClientErrorRecorder().toText()).toContain('未捕获到客户端错误');
  });

  it('订阅者收到记录，取消订阅后不再收到', () => {
    const recorder = new ClientErrorRecorder();
    const sink = vi.fn();
    const unsubscribe = recorder.subscribe(sink);

    recorder.record({ source: 'manual', error: new Error('A') });
    unsubscribe();
    recorder.record({ source: 'manual', error: new Error('B') });

    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('订阅者抛异常不影响记录落库', () => {
    const recorder = new ClientErrorRecorder();
    recorder.subscribe(() => {
      throw new Error('sink 挂了');
    });
    expect(() => recorder.record({ source: 'manual', error: new Error('真实故障') })).not.toThrow();
    expect(recorder.count()).toBe(1);
  });

  it('去重窗口内的同一异常实例只记一次（React 嵌套边界会重复上报同一实例）', () => {
    let now = 1_000;
    const recorder = new ClientErrorRecorder({ dedupeWindowMs: 3_000, now: () => now });

    // 同一个 Error 实例被逐层边界重复上报——真实场景下堆栈完全相同。
    const error = new Error('同一条');
    const first = recorder.record({ source: 'react-boundary', error });
    now += 100;
    const second = recorder.record({ source: 'react-boundary', error });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(recorder.count()).toBe(1);
  });

  it('不同位置的同名错误视为两次真实故障，不做去重', () => {
    let now = 1_000;
    const recorder = new ClientErrorRecorder({ dedupeWindowMs: 3_000, now: () => now });

    recorder.record({ source: 'uncaught', error: new Error('读取失败') });
    now += 10;
    const second = recorder.record({ source: 'uncaught', error: new Error('读取失败') });

    // 堆栈不同即代表不同调用点，折叠掉会掩盖真实的重复故障。
    expect(second).not.toBeNull();
    expect(recorder.count()).toBe(2);
  });

  it('超出容量时丢弃最旧记录', () => {
    const recorder = new ClientErrorRecorder({ capacity: 2 });
    recorder.record({ source: 'manual', error: new Error('第一条') });
    recorder.record({ source: 'manual', error: new Error('第二条') });
    recorder.record({ source: 'manual', error: new Error('第三条') });

    const messages = recorder.list().map((record) => record.message);
    expect(messages).toHaveLength(2);
    expect(messages).not.toContain('第一条');
  });

  it('敏感信息在入库前被脱敏', () => {
    const recorder = new ClientErrorRecorder();
    recorder.record({
      source: 'manual',
      error: new Error('调用失败 Authorization: Bearer abcdef123456'),
    });
    expect(recorder.list()[0]?.message).not.toContain('abcdef123456');
  });
});

describe('installGlobalErrorCapture', () => {
  it('捕获 error 与 unhandledrejection 事件', () => {
    const recorder = new ClientErrorRecorder();
    const listeners = new Map<string, (event: unknown) => void>();
    const target = {
      addEventListener: (type: string, listener: (event: never) => void) => {
        listeners.set(type, listener as (event: unknown) => void);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };

    const uninstall = installGlobalErrorCapture({ recorder, target });

    listeners.get('error')?.({ error: new Error('运行时异常'), filename: 'app.js', lineno: 12 });
    listeners.get('unhandledrejection')?.({ reason: new Error('未处理的拒绝') });

    const messages = recorder.list().map((record) => record.message);
    expect(messages).toContain('运行时异常');
    expect(messages).toContain('未处理的拒绝');
    // 定位信息必须一并记录，否则只知道「错了」不知道「在哪错的」。
    expect(recorder.list()[0]?.context?.['location']).toBe('app.js:12');

    uninstall();
    expect(listeners.size).toBe(0);
  });

  it('不支持 addEventListener 的环境返回空卸载函数而不抛错', () => {
    const recorder = new ClientErrorRecorder();
    const uninstall = installGlobalErrorCapture({ recorder, target: {} });
    expect(() => uninstall()).not.toThrow();
  });

  it('全局对象形态合法时可通过 globalThis 默认目标安装', () => {
    const recorder = new ClientErrorRecorder();
    const uninstall = installGlobalErrorCapture({ recorder });
    expect(() => uninstall()).not.toThrow();
  });
});
