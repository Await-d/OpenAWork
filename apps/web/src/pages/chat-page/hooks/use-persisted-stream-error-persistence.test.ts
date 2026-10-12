import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePersistedStreamError } from './use-persisted-stream-error.js';

describe('usePersistedStreamError', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('初始状态为 null', () => {
    const { result } = renderHook(() => usePersistedStreamError('test-session-id'));
    expect(result.current[0]).toBeNull();
  });

  it('可以设置错误信息', () => {
    const { result } = renderHook(() => usePersistedStreamError('test-session-id'));

    act(() => {
      result.current[1]('测试错误信息');
    });

    expect(result.current[0]).toBe('测试错误信息');
  });

  it('错误信息会持久化到 sessionStorage', () => {
    const { result } = renderHook(() => usePersistedStreamError('test-session-id'));

    act(() => {
      result.current[1]('持久化测试');
    });

    const stored = sessionStorage.getItem('chat_stream_error_test-session-id');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.error).toBe('持久化测试');
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  it('从 sessionStorage 恢复错误信息', () => {
    const errorData = {
      error: '已存在的错误',
      timestamp: Date.now(),
    };
    sessionStorage.setItem('chat_stream_error_test-session-id', JSON.stringify(errorData));

    const { result } = renderHook(() => usePersistedStreamError('test-session-id'));

    expect(result.current[0]).toBe('已存在的错误');
  });

  it('过期的错误不会被恢复', () => {
    const errorData = {
      error: '过期的错误',
      timestamp: Date.now() - 6 * 60 * 1000, // 6分钟前
    };
    sessionStorage.setItem('chat_stream_error_test-session-id', JSON.stringify(errorData));

    const { result } = renderHook(() => usePersistedStreamError('test-session-id'));

    expect(result.current[0]).toBeNull();
    expect(sessionStorage.getItem('chat_stream_error_test-session-id')).toBeNull();
  });

  it('清除错误时同时清除 sessionStorage', () => {
    const { result } = renderHook(() => usePersistedStreamError('test-session-id'));

    act(() => {
      result.current[1]('临时错误');
    });

    expect(sessionStorage.getItem('chat_stream_error_test-session-id')).toBeTruthy();

    act(() => {
      result.current[1](null);
    });

    expect(result.current[0]).toBeNull();
    expect(sessionStorage.getItem('chat_stream_error_test-session-id')).toBeNull();
  });

  it('支持函数式更新', () => {
    const { result } = renderHook(() => usePersistedStreamError('test-session-id'));

    act(() => {
      result.current[1]('初始错误');
    });

    act(() => {
      result.current[1]((prev) => (prev ? `${prev} - 更新` : '新错误'));
    });

    expect(result.current[0]).toBe('初始错误 - 更新');
  });

  it('sessionId 为 null 时不进行持久化', () => {
    const { result } = renderHook(() => usePersistedStreamError(null));

    act(() => {
      result.current[1]('测试错误');
    });

    expect(result.current[0]).toBe('测试错误');
    expect(sessionStorage.length).toBe(0);
  });

  it('不同的 sessionId 使用不同的存储键', () => {
    const { result: result1 } = renderHook(() => usePersistedStreamError('session-1'));
    const { result: result2 } = renderHook(() => usePersistedStreamError('session-2'));

    act(() => {
      result1.current[1]('会话1的错误');
    });

    act(() => {
      result2.current[1]('会话2的错误');
    });

    expect(result1.current[0]).toBe('会话1的错误');
    expect(result2.current[0]).toBe('会话2的错误');
    expect(sessionStorage.getItem('chat_stream_error_session-1')).toBeTruthy();
    expect(sessionStorage.getItem('chat_stream_error_session-2')).toBeTruthy();
  });
});
