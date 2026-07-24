import { useCallback } from 'react';
import { HttpError } from '@openAwork/web-client';
import { useAuthStore } from '../store/auth';

/**
 * 全局 401 事件订阅者列表。
 *
 * 移动端有大量页面直接调用 web-client API，每个 catch 块独立处理
 * 401 会导致遗漏。此模块提供了一个轻量的发布-订阅机制：
 * - `emitAuthError()`：在任意 catch 块中调用，如果 error 是 401 则
 *   调用 `logout()` 并通知所有订阅者。
 * - `subscribeAuthError()`：在 `_layout.tsx` 中订阅，收到 401 时
 *   执行路由跳转到 `/login`。
 *
 * 使用全局变量而非 React Context，因为：
 * 1. 错误可能在非 React 上下文（定时器回调等）中触发。
 * 2. 避免在每个页面包裹 Provider。
 */

type AuthErrorListener = () => void;

const listeners = new Set<AuthErrorListener>();

export function subscribeAuthError(listener: AuthErrorListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyAuthError() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * 检测错误是否为 401 认证失败。如果是，自动调用 `logout()` 并
 * 触发全局 401 事件，使 `_layout.tsx` 的守卫能跳转到登录页。
 *
 * 在任意 catch 块中使用：
 * ```ts
 * catch (error) {
 *   if (handleAuthError(error)) return;
 *   // ...其他错误处理
 * }
 * ```
 *
 * 也可以在非 React 上下文中直接调用 `emitAuthError(error)`。
 */
export function emitAuthError(error: unknown): boolean {
  if (error instanceof HttpError && error.status === 401) {
    notifyAuthError();
    return true;
  }
  return false;
}

export function useAuthErrorHandler() {
  const logout = useAuthStore((s) => s.logout);

  return useCallback(
    (error: unknown): boolean => {
      if (emitAuthError(error)) {
        void logout();
        return true;
      }
      return false;
    },
    [logout],
  );
}
