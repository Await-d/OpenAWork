import { useCallback, useState } from 'react';

import type { TeamClient } from '@openAwork/web-client';

import {
  buildRuntimeResumeResumingNotice,
  buildRuntimeResumeSubmittedNotice,
  type RuntimeResumeNotice,
} from './team-page-v2-runtime-resume-notice.js';

/**
 * 运行树控制（暂停 / 恢复全部）的统一包装：置 busy / 清 error → try → catch 交给 `onError`
 * → finally 清 busy。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，本组件 2 处
 * 这类 try 会让整个组件脱靶（实测）。语义逐字照搬。
 */
async function runTeamRuntimeControlOnce(ctx: {
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setBusy(true);
  ctx.setError(null);
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  } finally {
    ctx.setBusy(false);
  }
}

type UseTeamRuntimePauseControlOptions = {
  readonly accessToken: string | null;
  readonly teamClient: TeamClient;
  readonly selectedTeamId: string | null;
  readonly isSelectedSharedSession: boolean;
  readonly isSelectedTeamPaused: boolean;
  readonly staleHandoffCount: number;
  readonly canManageSelectedRuntimeTree: boolean;
  readonly refreshWorkspaceSnapshot: () => void;
};

/**
 * 团队运行树的暂停 / 恢复控制：确认弹窗编排、busy 与错误状态、恢复提示文案。
 *
 * `runTeamRuntimeControlOnce` 是配套的模块级包装（try/catch/finally 下沉，避免
 * React Compiler 脱靶）。
 */
export function useTeamRuntimePauseControl(options: UseTeamRuntimePauseControlOptions) {
  const {
    accessToken,
    teamClient,
    selectedTeamId,
    isSelectedSharedSession,
    isSelectedTeamPaused,
    staleHandoffCount,
    canManageSelectedRuntimeTree,
    refreshWorkspaceSnapshot,
  } = options;

  const [pauseResumeBusy, setPauseResumeBusy] = useState(false);
  const [runtimeControlError, setRuntimeControlError] = useState<string | null>(null);
  const [runtimeResumeNotice, setRuntimeResumeNotice] = useState<RuntimeResumeNotice | null>(null);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [showResumeStale, setShowResumeStale] = useState(false);

  const handlePauseAll = useCallback(() => {
    if (!canManageSelectedRuntimeTree || isSelectedTeamPaused || pauseResumeBusy) {
      return;
    }
    setShowPauseConfirm(true);
  }, [canManageSelectedRuntimeTree, isSelectedTeamPaused, pauseResumeBusy]);

  const handleConfirmPauseAll = useCallback(async () => {
    setShowPauseConfirm(false);
    if (
      !accessToken ||
      !teamClient ||
      !selectedTeamId ||
      isSelectedSharedSession ||
      pauseResumeBusy
    ) {
      return;
    }
    setRuntimeResumeNotice(null);
    // 置 busy / 清 error 与 try/catch/finally 一起下沉到模块级
    // `runTeamRuntimeControlOnce`（见其注释）。
    await runTeamRuntimeControlOnce({
      setBusy: setPauseResumeBusy,
      setError: setRuntimeControlError,
      onError: (error) => {
        setRuntimeControlError(error instanceof Error ? error.message : '暂停运行树失败');
      },
      run: async () => {
        await teamClient.pauseAllRuntimeSessions(accessToken, selectedTeamId, {
          reason: 'team-page-v2-pause-all',
        });
        refreshWorkspaceSnapshot();
      },
    });
  }, [
    accessToken,
    isSelectedSharedSession,
    pauseResumeBusy,
    refreshWorkspaceSnapshot,
    selectedTeamId,
    teamClient,
  ]);

  const handleResumeAll = useCallback(async () => {
    setShowResumeStale(false);
    if (
      !accessToken ||
      !teamClient ||
      !selectedTeamId ||
      isSelectedSharedSession ||
      !isSelectedTeamPaused ||
      pauseResumeBusy
    ) {
      return;
    }
    setRuntimeResumeNotice(buildRuntimeResumeResumingNotice());
    // 同暂停：整段下沉到 `runTeamRuntimeControlOnce`（见其注释）。
    await runTeamRuntimeControlOnce({
      setBusy: setPauseResumeBusy,
      setError: setRuntimeControlError,
      onError: (error) => {
        setRuntimeResumeNotice(null);
        setRuntimeControlError(error instanceof Error ? error.message : '恢复运行树失败');
      },
      run: async () => {
        const result = await teamClient.resumeAllRuntimeSessions(accessToken, selectedTeamId);
        setRuntimeResumeNotice(buildRuntimeResumeSubmittedNotice(result));
        refreshWorkspaceSnapshot();
      },
    });
  }, [
    accessToken,
    isSelectedSharedSession,
    isSelectedTeamPaused,
    pauseResumeBusy,
    refreshWorkspaceSnapshot,
    selectedTeamId,
    teamClient,
  ]);

  const handleRequestResumeAll = useCallback(() => {
    if (staleHandoffCount > 0) {
      setShowResumeStale(true);
      return;
    }
    void handleResumeAll();
  }, [handleResumeAll, staleHandoffCount]);

  return {
    pauseResumeBusy,
    runtimeControlError,
    runtimeResumeNotice,
    showPauseConfirm,
    showResumeStale,
    handlePauseAll,
    handleConfirmPauseAll,
    handleResumeAll,
    handleRequestResumeAll,
    closePauseConfirm: useCallback(() => setShowPauseConfirm(false), []),
    closeResumeStale: useCallback(() => setShowResumeStale(false), []),
  };
}
