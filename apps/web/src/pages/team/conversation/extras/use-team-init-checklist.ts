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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setPendingStepKey(stepKey);
      try {
        const result = await client.confirmSessionInitStep(accessToken, input.sessionId, stepKey);
        applyResult(result);
      } finally {
        setPendingStepKey(null);
      }
    },
    [accessToken, applyResult, client, input.sessionId, pendingStepKey],
  );

  const skipStep = useCallback(
    async (stepKey: TeamInitStepKey) => {
      if (!accessToken || pendingStepKey !== null) return;
      setPendingStepKey(stepKey);
      try {
        const result = await client.skipSessionInitStep(accessToken, input.sessionId, stepKey);
        applyResult(result);
      } finally {
        setPendingStepKey(null);
      }
    },
    [accessToken, applyResult, client, input.sessionId, pendingStepKey],
  );

  const skipAll = useCallback(async () => {
    if (!accessToken || pendingStepKey !== null) return;
    setPendingStepKey('all');
    try {
      const result = await client.skipSessionInit(accessToken, input.sessionId);
      applyResult(result);
    } finally {
      setPendingStepKey(null);
    }
  }, [accessToken, applyResult, client, input.sessionId, pendingStepKey]);

  // 顺序确认所有 proposed 步骤（一键完成初始化）。
  const confirmAllPending = useCallback(async () => {
    if (!accessToken || pendingStepKey !== null || !teamInit) return;
    const pendingKeys = teamInit.steps
      .filter((step) => step.status === 'proposed')
      .map((step) => step.key);
    if (pendingKeys.length === 0) return;
    setPendingStepKey('all');
    try {
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
    } finally {
      setPendingStepKey(null);
    }
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
