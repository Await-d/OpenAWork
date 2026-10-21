import { type SetStateAction, useEffect, useState } from 'react';

/**
 * 不应跨刷新 / 切会话残留的瞬时错误。
 *
 * 「实时流连接已断开」是 attach 续接通道的单次传输中断：前端会自动重连，且重连
 * 成功后本就会清空错误条。把它持久化会让用户切走再切回、或刷新后仍看到这条提示，
 * 观感就是「一会儿就提示断流重连」。命中即丢弃（并清掉旧版本留下的存量记录）。
 */
const TRANSIENT_STREAM_ERROR_PATTERNS = ['实时流连接已断开'] as const;

function isTransientStreamError(message: string): boolean {
  return TRANSIENT_STREAM_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * 持久化流式错误状态
 * 将错误信息存储到 sessionStorage 中，刷新页面后仍能显示
 */
export function usePersistedStreamError(sessionId: string | null) {
  const [streamError, setStreamErrorState] = useState<string | null>(null);

  // 生成存储键
  const storageKey = sessionId ? `chat_stream_error_${sessionId}` : null;

  // 从 sessionStorage 恢复错误状态
  useEffect(() => {
    setStreamErrorState(null);
    if (!storageKey) return;

    // 读取与解析各自单独 try：`try` 块内只允许简单条件，混入 `&&` 之类逻辑运算
    // 会触发 React Compiler 的能力缺口，导致本 hook 整段放弃编译（丢全部 memo）。
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(storageKey);
    } catch (err) {
      console.error('读取 streamError 失败:', err);
      return;
    }
    if (!stored) return;

    let parsed: { error: string; timestamp: number };
    try {
      parsed = JSON.parse(stored) as { error: string; timestamp: number };
    } catch (err) {
      console.error('解析 streamError 失败:', err);
      sessionStorage.removeItem(storageKey);
      return;
    }

    // 只恢复 5 分钟内、且不是瞬时传输错误的条目。
    const isFresh = Date.now() - parsed.timestamp < 5 * 60 * 1000;
    if (isFresh && !isTransientStreamError(parsed.error)) {
      setStreamErrorState(parsed.error);
      return;
    }
    // 过期的 / 瞬时传输错误清除掉（后者还会残留成「切回来仍提示断流」）。
    sessionStorage.removeItem(storageKey);
  }, [storageKey]);

  // 包装 setter，同时更新 sessionStorage
  const setStreamError = (action: SetStateAction<string | null>) => {
    setStreamErrorState((prevError) => {
      // 计算新的错误值
      const newError = typeof action === 'function' ? action(prevError) : action;

      if (!storageKey) return newError;

      // 判定放在 try/catch 之外：`try` 块内只允许简单条件，混入逻辑运算会让
      // React Compiler 放弃编译这个函数（compiler-limit），从而丢失全部 memo。
      const shouldPersist = Boolean(newError) && !isTransientStreamError(newError ?? '');

      try {
        if (shouldPersist) {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({
              error: newError,
              timestamp: Date.now(),
            }),
          );
        } else {
          // 瞬时传输错误只留在内存里：重连成功会立刻清掉，不写盘就不会残留。
          sessionStorage.removeItem(storageKey);
        }
      } catch (err) {
        console.error('保存 streamError 失败:', err);
      }

      return newError;
    });
  };

  return [streamError, setStreamError] as const;
}
