/**
 * 视口高度订阅（渲染期可得的来源）。
 *
 * 用 useSyncExternalStore 而非「resize 监听 + setState」：快照直接读
 * `window.innerHeight` 这个原始值，resize 只负责触发重读，不引入中间 state，
 * 也不存在 effect 挂载前的首帧错值。
 *
 * 视口不可用（SSR / 测试替身）返回 0，由调用方的 bounds 解析函数统一回落到
 * 静态 bounds——fallback 只维护一处。
 */

import { useSyncExternalStore } from 'react';

function subscribeToResize(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

function getViewportHeightSnapshot(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  return window.innerHeight;
}

export function useViewportHeight(): number {
  return useSyncExternalStore(subscribeToResize, getViewportHeightSnapshot, () => 0);
}
