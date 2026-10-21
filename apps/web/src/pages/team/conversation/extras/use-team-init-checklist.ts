/**
 * use-team-init-checklist · 团队会话「初始化阶段」清单交互 hook
 *
 * 负责：
 *   - 从传入的 sessionMetadata.teamInit 取初始状态（避免首屏多一次请求）
 *   - 调 web-client 的 confirm / skip 端点执行 / 跳过步骤
 *   - 操作返回的最新 teamInit 直接驱动本地状态；同时 session.init.changed 事件
 *     会触发外层 reload，metadata 更新后通过 effect 同步进来
 *
 * 设计要点：每个带副作用的步骤都需要用户显式点「执行 / 跳过」，与方案约束一致。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createTeamClient, type TeamInitActionResult } from '@openAwork/web-client';
import type { TeamInitState, TeamInitStepKey } from '@openAwork/shared';
import { isTeamInitFinished } from '@openAwork/shared';
import { useAuthStore } from '../../../../stores/auth/auth.js';

interface UseTeamInitChecklistInput {
  sessionId: string;
  /** 已解析的会话 metadata（含 teamInit），来源同 TeamSessionEmptyState。 */
  sessionMetadata?: Record<string, unknown> | null;
}

export interface TeamInitChecklistState {
  teamInit: TeamInitState | null;
  /** 当前正在执行的步骤 key（用于禁用按钮 / 显示 spinner）。 */
  pendingStepKey: TeamInitStepKey | 'all' | null;
  error: string | null;
  finished: boolean;
  confirmStep: (stepKey: TeamInitStepKey) => Promise<void>;
  skipStep: (stepKey: TeamInitStepKey) => Promise<void>;
  skipAll: () => Promise<void>;
  confirmAllPending: () => Promise<void>;
}

function extractTeamInit(metadata?: Record<string, unknown> | null): TeamInitState | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = metadata['teamInit'];
  if (!raw || typeof raw !== 'object') return null;
  return raw as TeamInitState;
}

/**
 * 「置 pendingStepKey → 执行 → 必清 pendingStepKey」的统一包装（**无 catch**：异常继续
 * 向上抛给调用方，与原语义一致）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，本 hook 4 处
 * 该类动作会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runWithPendingStepKey(ctx: {
  pendingKey: TeamInitStepKey | 'all';
  setPendingStepKey: (key: TeamInitStepKey | 'all' | null) => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setPendingStepKey(ctx.pendingKey);
  try {
    await ctx.run();
  } finally {
    ctx.setPendingStepKey(null);
  }
}

export function useTeamInitChecklist(input: UseTeamInitChecklistInput): TeamInitChecklistState {
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const client = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);

  const metadataTeamInit = extractTeamInit(input.sessionMetadata);
  const [teamInit, setTeamInit] = useState<TeamInitState | null>(metadataTeamInit);
  const [pendingStepKey, setPendingStepKey] = useState<TeamInitStepKey | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // metadata（来自 reload）更新时同步本地状态——但不要覆盖正在进行的乐观更新。
  useEffect(() => {
    if (pendingStepKey !== null) return;
    setTeamInit(metadataTeamInit);
    // metadataTeamInit 是每次渲染新建的对象，用 JSON 签名做依赖，避免无限循环。
    // 依赖省略是刻意取舍。不要在此处加回 lint 抑制指令——编译器按文本匹配
    // 识别它，会把整个 hook 判为「已手动抑制」而放弃优化。
  }, [JSON.stringify(metadataTeamInit), pendingStepKey]);

  const applyResult = useCallback((result: TeamInitActionResult) => {
    if (result.ok) {
      if (result.teamInit) setTeamInit(result.teamInit);
      setError(null);
    } else {
      if (result.teamInit) setTeamInit(result.teamInit);
      setError(result.errorMessage ?? '初始化操作失败。');
    }
  }, []);

  const confirmStep = useCallback(
    async (stepKey: TeamInitStepKey) => {
      if (!accessToken || pendingStepKey !== null) return;
      // try/finally 下沉到模块级 `runWithPendingStepKey`（见其注释）。
      await runWithPendingStepKey({
        pendingKey: stepKey,
        setPendingStepKey,
        run: async () => {
          const result = await client.confirmSessionInitStep(accessToken, input.sessionId, stepKey);
          applyResult(result);
        },
      });
    },
    [accessToken, applyResult, client, input.sessionId, pendingStepKey],
  );

  const skipStep = useCallback(
    async (stepKey: TeamInitStepKey) => {
      if (!accessToken || pendingStepKey !== null) return;
      // try/finally 下沉到模块级 `runWithPendingStepKey`（见其注释）。
      await runWithPendingStepKey({
        pendingKey: stepKey,
        setPendingStepKey,
        run: async () => {
          const result = await client.skipSessionInitStep(accessToken, input.sessionId, stepKey);
          applyResult(result);
        },
      });
    },
    [accessToken, applyResult, client, input.sessionId, pendingStepKey],
  );

  const skipAll = useCallback(async () => {
    if (!accessToken || pendingStepKey !== null) return;
    // try/finally 下沉到模块级 `runWithPendingStepKey`（见其注释）。
    await runWithPendingStepKey({
      pendingKey: 'all',
      setPendingStepKey,
      run: async () => {
        const result = await client.skipSessionInit(accessToken, input.sessionId);
        applyResult(result);
      },
    });
  }, [accessToken, applyResult, client, input.sessionId, pendingStepKey]);

  // 顺序确认所有 proposed 步骤（一键完成初始化）。
  const confirmAllPending = useCallback(async () => {
    if (!accessToken || pendingStepKey !== null || !teamInit) return;
    const pendingKeys = teamInit.steps
      .filter((step) => step.status === 'proposed')
      .map((step) => step.key);
    if (pendingKeys.length === 0) return;
    // try/finally 下沉到模块级 `runWithPendingStepKey`（见其注释）。
    await runWithPendingStepKey({
      pendingKey: 'all',
      setPendingStepKey,
      run: async () => {
        let latest: TeamInitActionResult | null = null;
        for (const key of pendingKeys) {
          latest = await client.confirmSessionInitStep(accessToken, input.sessionId, key);
          if (latest.teamInit) setTeamInit(latest.teamInit);
          if (!latest.ok) {
            setError(latest.errorMessage ?? '初始化操作失败。');
            break;
          }
        }
        if (latest?.ok) setError(null);
      },
    });
  }, [accessToken, client, input.sessionId, pendingStepKey, teamInit]);

  return {
    teamInit,
    pendingStepKey,
    error,
    finished: isTeamInitFinished(teamInit),
    confirmStep,
    skipStep,
    skipAll,
    confirmAllPending,
  };
}
