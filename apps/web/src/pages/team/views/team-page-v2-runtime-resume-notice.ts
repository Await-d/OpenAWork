import type { CSSProperties } from 'react';
import type { TeamRuntimeResumeAllResult } from '@openAwork/web-client';

type RuntimeResumeNoticePhase = 'resuming' | 'submitted';
type TeamConsistencyFix = TeamRuntimeResumeAllResult['consistencyFixes'][number];

export interface RuntimeResumeNotice {
  detail: string;
  phase: RuntimeResumeNoticePhase;
  title: string;
  truncated: boolean;
}

const RUNTIME_RESUME_NOTICE_BASE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm, 6px)',
  boxShadow: 'var(--shadow-sm)',
  backdropFilter: 'blur(14px)',
  fontSize: 12,
  flexShrink: 0,
};

const RUNTIME_RESUME_NOTICE_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 'var(--radius-pill, 9999px)',
  flexShrink: 0,
};

const LAYER_LABELS: Record<string, string> = {
  reception: '接待层',
  pm1: 'PM1 规划层',
  pm2: 'PM2 管控层',
  executor: '执行层',
  reviewer: '审查层',
};

const CONSISTENCY_FIX_LABELS: Record<TeamConsistencyFix['type'], string> = {
  orphan_session_cancelled: '孤立会话',
  zombie_handoff_failed: '僵尸任务',
  duplicate_handoff_cancelled: '重复任务',
  stale_heartbeat_reclaimed: '过期心跳',
  stuck_running_reset: '卡死状态',
};

const RESUME_MODE_LABELS: Record<string, string> = {
  'signal-only': '信号恢复',
  'background-rerun': '后台续跑',
  'full-rebuild': '全量重建',
};

export function buildRuntimeResumeResumingNotice(): RuntimeResumeNotice {
  return {
    title: '正在恢复团队会话',
    detail: '准备后台读取恢复上下文继续调度。',
    phase: 'resuming',
    truncated: false,
  };
}

export function buildRuntimeResumeSubmittedNotice(
  result: TeamRuntimeResumeAllResult,
): RuntimeResumeNotice {
  const resumedParts = [
    result.resumedSessionCount > 0 ? `${result.resumedSessionCount} 个会话` : null,
    result.resumedHandoffCount > 0 ? `${result.resumedHandoffCount} 个 handoff` : null,
  ].filter((part): part is string => part !== null);
  const resumedText =
    resumedParts.length > 0 ? `已恢复 ${resumedParts.join('、')}` : '已发送恢复请求';

  // 分层恢复信息
  const skipParts: string[] = [];
  if (result.skippedSessionCount > 0) {
    skipParts.push(`${result.skippedSessionCount} 个已完成/终态会话已跳过`);
  }
  if (result.userBlockedSessionCount > 0) {
    const blockedLayers =
      result.userBlockedSessionIds.length > 0
        ? `（${result.userBlockedSessionIds.length} 个需回答问题）`
        : '';
    skipParts.push(`${result.userBlockedSessionCount} 个会话保持暂停${blockedLayers}`);
  }

  // 一致性修复信息
  const consistencyParts: string[] = [];
  if (result.consistencyFixCount > 0) {
    const fixTypeCounts = new Map<string, number>();
    for (const fix of result.consistencyFixes) {
      const label = CONSISTENCY_FIX_LABELS[fix.type] ?? fix.type;
      fixTypeCounts.set(label, (fixTypeCounts.get(label) ?? 0) + 1);
    }
    const fixSummary = Array.from(fixTypeCounts.entries())
      .map(([label, count]) => `${label} ${count} 个`)
      .join('、');
    consistencyParts.push(`修复 ${result.consistencyFixCount} 个不一致状态：${fixSummary}`);
  }

  // 恢复模式信息
  const modeLabel = RESUME_MODE_LABELS[result.resumeMode] ?? result.resumeMode;
  const rerunTarget = result.backgroundRerunTarget
    ? `，续跑 ${LAYER_LABELS[result.backgroundRerunTarget.roleLayer ?? ''] ?? result.backgroundRerunTarget.roleLayer ?? '未知层'}`
    : '';

  const truncationText = result.truncated
    ? `恢复范围已触发截断，至少省略 ${result.omittedSessionCount} 个会话。`
    : '';

  // 组装详情
  const detailParts: string[] = [resumedText];
  if (skipParts.length > 0) {
    detailParts.push(skipParts.join('；'));
  }
  if (consistencyParts.length > 0) {
    detailParts.push(consistencyParts.join('；'));
  }
  detailParts.push(`恢复模式：${modeLabel}${rerunTarget}。`);
  if (truncationText) {
    detailParts.push(truncationText);
  }

  // 如果有用户阻塞态，标题加提示
  const hasUserBlocked = result.userBlockedSessionCount > 0;
  const title = hasUserBlocked ? '恢复已提交（部分需交互）' : '恢复已提交';

  return {
    detail: detailParts.join(' '),
    phase: 'submitted',
    title,
    truncated: result.truncated,
  };
}

export function getRuntimeResumeNoticeStyle(input: {
  isMobile: boolean;
  phase: RuntimeResumeNoticePhase;
  truncated: boolean;
}): CSSProperties {
  const tone = input.truncated ? 'warning' : input.phase === 'resuming' ? 'info' : 'success';
  return {
    ...RUNTIME_RESUME_NOTICE_BASE_STYLE,
    margin: input.isMobile ? '4px 8px' : '4px 12px',
    background: `color-mix(in srgb, var(--${tone}) 12%, var(--bg-overlay))`,
    border: `1px solid color-mix(in srgb, var(--${tone}) 36%, transparent)`,
    color: `var(--${tone})`,
  };
}

export function getRuntimeResumeNoticeDotStyle(input: {
  phase: RuntimeResumeNoticePhase;
  truncated: boolean;
}): CSSProperties {
  const tone = input.truncated ? 'warning' : input.phase === 'resuming' ? 'info' : 'success';
  return {
    ...RUNTIME_RESUME_NOTICE_DOT_STYLE,
    background: `var(--${tone})`,
    boxShadow: `0 0 0 4px color-mix(in srgb, var(--${tone}) 14%, transparent)`,
  };
}
