export function resolveTopSummaryStatus(input: {
  hasPausedRuntimeSessions: boolean;
  selectedRuntimeSessionPaused?: boolean | null;
  selectedRuntimeSessionStateStatus?: string | null;
  selectedSharedSessionStateStatus?: string | null;
}): string {
  if (
    input.selectedSharedSessionStateStatus === 'paused' ||
    input.selectedSharedSessionStateStatus === 'idle'
  ) {
    return '已暂停';
  }

  if (input.selectedRuntimeSessionPaused === true) {
    return '已暂停';
  }

  if (
    input.selectedRuntimeSessionStateStatus === 'paused' ||
    input.selectedRuntimeSessionStateStatus === 'idle'
  ) {
    return '已暂停';
  }

  if (
    input.selectedRuntimeSessionPaused != null ||
    input.selectedSharedSessionStateStatus != null ||
    input.selectedRuntimeSessionStateStatus != null
  ) {
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
  paused?: boolean | null;
  stateStatus?: string | null;
}): string {
  if (input.paused === true || input.stateStatus === 'paused' || input.stateStatus === 'idle') {
    return '已暂停';
  }
  if (input.stateStatus === 'running') {
    return '运行中';
  }
  if (input.stateStatus === 'failed') {
    return '失败';
  }
  if (input.stateStatus === 'completed') {
    return '已完成';
  }
  return '空闲';
}

function resolveSharedSessionStatusLabel(stateStatus?: string | null): string {
  if (stateStatus === 'running') {
    return '运行中';
  }
  if (stateStatus === 'paused' || stateStatus === 'idle') {
    return '已暂停';
  }
  return '已空闲';
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
  selectedRuntimeSessionPaused?: boolean | null;
  selectedRuntimeSessionStateStatus?: string | null;
  selectedRuntimeSessionTitle?: string | null;
  selectedSharedSessionId?: string | null;
  selectedSharedSessionStateStatus?: string | null;
  selectedSharedSessionTitle?: string | null;
  selectedSharedWorkspaceLabel?: string | null;
  workspaceOverviewLead?: string | null;
}): string {
  const runtimeTitle = input.selectedRuntimeSessionTitle?.trim() || input.selectedRuntimeSessionId;
  if (runtimeTitle) {
    return `当前会话：${runtimeTitle} · ${resolveRuntimeSessionStatusLabel({
      paused: input.selectedRuntimeSessionPaused,
      stateStatus: input.selectedRuntimeSessionStateStatus,
    })}`;
  }

  const sharedTitle = input.selectedSharedSessionTitle?.trim() || input.selectedSharedSessionId;
  if (sharedTitle) {
    const workspaceSuffix = input.selectedSharedWorkspaceLabel
      ? ` · ${input.selectedSharedWorkspaceLabel}`
      : '';
    return `当前共享：${sharedTitle} · ${resolveSharedSessionStatusLabel(input.selectedSharedSessionStateStatus)}${workspaceSuffix}`;
  }

  if (input.activeWorkspaceName?.trim()) {
    return `${input.activeWorkspaceName} · ${input.activeWorkspaceWorkingRoot ?? '未绑定默认工作区'} · ${input.workspaceOverviewLead ?? '已切换到 TeamWorkspaceSnapshot 主读链'}`;
  }

  if (input.selectedSharedWorkspaceLabel?.trim()) {
    return `${input.selectedSharedWorkspaceLabel} · ${input.workspaceOverviewLead ?? '已接入真实 Team Runtime 视图。'}`;
  }

  return '当前已切换到真实 Team Runtime 数据源，等待第一条共享运行进入。';
}
