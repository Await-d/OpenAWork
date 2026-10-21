export interface ActiveLocalStreamPreservationInput {
  readonly activeSessionId: string | null;
  readonly isStreaming: boolean;
  readonly loadedSessionId?: string | null;
  readonly requestedSessionId: string | null;
}

export function shouldPreserveActiveLocalStream(
  input: ActiveLocalStreamPreservationInput,
): boolean {
  return (
    input.isStreaming &&
    input.requestedSessionId !== null &&
    input.requestedSessionId === (input.loadedSessionId ?? input.activeSessionId)
  );
}

export interface FreshBootstrapStreamInput {
  /**
   * 上一次「已加载完成」的会话 id。`null` 表示还没有任何会话加载完成过
   * （典型场景：首页 → 新建会话 → 发出第一条消息）。
   */
  readonly loadedSessionId: string | null;
  readonly isStreaming: boolean;
}

/**
 * 新会话的「第一条消息」是否正在本地渲染。
 *
 * `ensureSession` 建好会话后，`startStandardChatStream` 会立刻乐观追加用户消息并
 * 置 `streaming`，而 `currentLoadedSessionIdRef` 要等 lifecycle effect 提交后才镜像
 * 到新会话。中间这段窗口里，会话切换 effect 若按「会话 id 不一致」执行重置
 * （`setMessages([])` / `setSessionStateStatus(null)` / `resetStreamState()`），
 * 就会把正在进行的首轮对话打断——用户看到的就是「首次发送拿不到对话，只能刷新
 * 或切会话」。因此这段窗口必须与 bootstrap 分支同等对待、整段跳过。
 *
 * 判定刻意要求 `loadedSessionId === null`：正常在 A↔B 间切换时它非空，
 * 此时绝不能跳过（否则会串会话）。
 */
export function shouldPreserveFreshBootstrapStream(input: FreshBootstrapStreamInput): boolean {
  return input.loadedSessionId === null && input.isStreaming;
}
