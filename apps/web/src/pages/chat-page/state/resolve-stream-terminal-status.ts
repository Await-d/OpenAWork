export type ChatSessionStateStatus = 'idle' | 'running' | 'paused' | null | undefined;

/**
 * 计算旧流收到终态事件时应写入的会话状态。
 *
 * 权限 / 提问暂停后，回复请求会先把状态乐观置为 `running`，而暂停前的旧流可能
 * 在回复之后才收到 `done`。这种迟到事件只能保留已经恢复的 running；未回复时保留
 * paused，而已被用户忽略并收敛为 idle 的请求仍然保持 idle。
 */
export function resolveStreamTerminalStatus(input: {
  currentStatus: ChatSessionStateStatus;
  pausedForPermission: boolean;
  pausedForQuestion: boolean;
}): 'idle' | 'running' | 'paused' {
  if (input.pausedForPermission || input.pausedForQuestion) {
    if (input.currentStatus === 'running') {
      return 'running';
    }
    if (input.currentStatus === 'paused') {
      return 'paused';
    }
  }
  return 'idle';
}
