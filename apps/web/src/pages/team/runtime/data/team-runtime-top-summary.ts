import {
  formatTeamRuntimeSemanticStatus,
  type TeamRuntimeSemanticStatus,
} from './team-runtime-status.js';

export function resolveTopSummaryStatus(input: {
  hasPausedRuntimeSessions: boolean;
  selectedRuntimeStatus?: TeamRuntimeSemanticStatus | null;
  selectedSharedStatus?: TeamRuntimeSemanticStatus | null;
}): string {
  if (input.selectedSharedStatus === 'paused') {
    return '已暂停';
  }

  if (input.selectedRuntimeStatus === 'paused') {
    return '已暂停';
  }

  if (input.selectedRuntimeStatus != null || input.selectedSharedStatus != null) {
    return '运行中';
  }

  return input.hasPausedRuntimeSessions ? '已暂停' : '运行中';
}

export function resolveTopSummaryAudience(input: {
  sharedSelected?: boolean;
  sharedPresenceCount?: number | null;
  sharedActiveViewerCount?: number | null;
  workspaceMemberCount: number;
  workspaceOnlineCount: number;
}): { memberCount: string; onlineCount: string } {
  if (input.sharedSelected) {
    const sharedOnlineCount = Math.max(0, input.sharedActiveViewerCount ?? 0);
    const sharedMemberCount = Math.max(sharedOnlineCount, input.sharedPresenceCount ?? 0);
    return {
      memberCount: `${sharedMemberCount} 成员`,
      onlineCount: `${sharedOnlineCount} 在线`,
    };
  }

  return {
    memberCount: `${input.workspaceMemberCount} 成员`,
    onlineCount: `${input.workspaceOnlineCount} 在线`,
  };
}

function resolveRuntimeSessionStatusLabel(input: {
  status?: TeamRuntimeSemanticStatus | null;
}): string {
  return formatTeamRuntimeSemanticStatus(input.status ?? 'idle');
}

function resolveSharedSessionStatusLabel(status?: TeamRuntimeSemanticStatus | null): string {
  return formatTeamRuntimeSemanticStatus(status ?? 'idle');
}

export function resolveTopSummaryTitle(input: {
  activeWorkspaceName?: string | null;
  selectedRuntimeSessionTitle?: string | null;
  selectedRuntimeSessionId?: string | null;
  selectedSharedSessionTitle?: string | null;
  selectedSharedSessionId?: string | null;
}): string {
  if (input.selectedRuntimeSessionTitle?.trim()) {
    return input.selectedRuntimeSessionTitle;
  }

  if (input.selectedSharedSessionTitle?.trim()) {
    return input.selectedSharedSessionTitle;
  }

  if (input.activeWorkspaceName?.trim()) {
    return input.activeWorkspaceName;
  }

  if (input.selectedRuntimeSessionId) {
    return input.selectedRuntimeSessionId;
  }

  if (input.selectedSharedSessionId) {
    return input.selectedSharedSessionId;
  }

  return '团队工作空间';
}

export function resolveTopSummaryDescription(input: {
  activeWorkspaceName?: string | null;
  activeWorkspaceWorkingRoot?: string | null;
  selectedRuntimeSessionId?: string | null;
  selectedRuntimeStatus?: TeamRuntimeSemanticStatus | null;
  selectedRuntimeSessionTitle?: string | null;
  selectedSharedSessionId?: string | null;
  selectedSharedStatus?: TeamRuntimeSemanticStatus | null;
  selectedSharedSessionTitle?: string | null;
  selectedSharedWorkspaceLabel?: string | null;
  workspaceOverviewLead?: string | null;
}): string {
  const runtimeTitle = input.selectedRuntimeSessionTitle?.trim() || input.selectedRuntimeSessionId;
  if (runtimeTitle) {
    return `当前会话：${runtimeTitle} · ${resolveRuntimeSessionStatusLabel({
      status: input.selectedRuntimeStatus,
    })}`;
  }

  const sharedTitle = input.selectedSharedSessionTitle?.trim() || input.selectedSharedSessionId;
  if (sharedTitle) {
    const workspaceSuffix = input.selectedSharedWorkspaceLabel
      ? ` · ${input.selectedSharedWorkspaceLabel}`
      : '';
    return `当前共享：${sharedTitle} · ${resolveSharedSessionStatusLabel(input.selectedSharedStatus)}${workspaceSuffix}`;
  }

  if (input.activeWorkspaceName?.trim()) {
    return `${input.activeWorkspaceName} · ${input.activeWorkspaceWorkingRoot ?? '未绑定默认工作区'} · ${input.workspaceOverviewLead ?? '已切换到 TeamWorkspaceSnapshot 主读链'}`;
  }

  if (input.selectedSharedWorkspaceLabel?.trim()) {
    return `${input.selectedSharedWorkspaceLabel} · ${input.workspaceOverviewLead ?? '已接入真实 Team Runtime 视图。'}`;
  }

  return '当前已切换到真实 Team Runtime 数据源，等待第一条共享运行进入。';
}
