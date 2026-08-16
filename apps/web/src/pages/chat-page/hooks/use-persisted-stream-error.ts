import { type SetStateAction, useEffect, useState } from 'react';

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

    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { error: string; timestamp: number };
        // 只恢复 5 分钟内的错误
        const now = Date.now();
        if (now - parsed.timestamp < 5 * 60 * 1000) {
          setStreamErrorState(parsed.error);
        } else {
          // 过期的错误清除掉
          sessionStorage.removeItem(storageKey);
        }
      }
    } catch (err) {
      console.error('恢复 streamError 失败:', err);
    }
  }, [storageKey]);

  // 包装 setter，同时更新 sessionStorage
  const setStreamError = (action: SetStateAction<string | null>) => {
    setStreamErrorState((prevError) => {
      // 计算新的错误值
      const newError = typeof action === 'function' ? action(prevError) : action;

      if (!storageKey) return newError;

      try {
        if (newError) {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({
              error: newError,
              timestamp: Date.now(),
            }),
          );
        } else {
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
