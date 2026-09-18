/**
 * 团队页「按会话记忆」上下文。
 *
 * 这是内层 tab / 筛选 / 视图模式的「按会话记忆」统一入口：二期消费者一律走
 * useTeamTabState，不要再自己读写 localStorage（会话切换、归一化、旧数据迁移
 * 都由 useTeamSessionViewState + 本上下文统一处理）。
 *
 * React 19 写法：直接用 `<TeamSessionViewStateContext value={...}>`，不再使用 `.Provider`。
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { TeamTabStateValue } from './team-session-view-state-storage.js';
import type { TeamSessionViewStateControls } from './use-team-session-view-state.js';

const TeamSessionViewStateContext = createContext<TeamSessionViewStateControls | null>(null);

export function TeamSessionViewStateProvider(props: {
  readonly value: TeamSessionViewStateControls;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <TeamSessionViewStateContext value={props.value}>{props.children}</TeamSessionViewStateContext>
  );
}

/**
 * 可选读取上下文：脱离 Provider 渲染（单测 / dev harness / 独立预览）时返回 null，
 * 由调用方自行降级；需要强约束的场景请用 useTeamSessionViewStateContext。
 */
export function useTeamSessionViewStateContextOptional(): TeamSessionViewStateControls | null {
  return useContext(TeamSessionViewStateContext);
}

export function useTeamSessionViewStateContext(): TeamSessionViewStateControls {
  const value = useTeamSessionViewStateContextOptional();
  if (value === null) {
    throw new Error('useTeamSessionViewStateContext 必须在 TeamSessionViewStateProvider 内使用');
  }
  return value;
}

/**
 * 读写某个「按会话记忆」的局部状态（内层 tab / 筛选 / 视图模式）。
 *
 * - 切换会话后按新作用域重新读取：effect 依赖 [scopeKey, key]；provider 的作用域同步
 *   layout effect 先于本被动 effect 完成，因此读到的必是新会话的记忆。
 * - fallback 刻意不进依赖数组：调用方必须传原始值或模块级常量（不要每次渲染新建
 *   对象 / 数组），否则一旦把它放进依赖会让 effect 反复重跑。
 */
export function useTeamTabState<T extends TeamTabStateValue>(
  key: string,
  fallback: T,
): readonly [T, (next: T) => void] {
  const controls = useTeamSessionViewStateContextOptional();
  const scopeKey = controls?.scopeKey ?? null;
  const readTabState = controls?.readTabState;
  const writeTabState = controls?.writeTabState;

  // 脱离 Provider 时退化为纯本地 state（不记忆、不抛错），保证组件可独立渲染与单测。
  const [value, setValue] = useState<T>(() =>
    readTabState ? readTabState(key, fallback) : fallback,
  );

  useEffect(() => {
    if (!readTabState) {
      return;
    }
    setValue(readTabState(key, fallback));
  }, [scopeKey, key, readTabState]);

  const setTabValue = useCallback(
    (next: T) => {
      setValue(next);
      writeTabState?.(key, next);
    },
    [key, writeTabState],
  );

  return [value, setTabValue] as const;
}
