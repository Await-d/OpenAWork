/**
 * 移动端 `/status` 轮询的活跃判定。
 *
 * 与 web 侧 `shouldPollSessionRuntime`
 * （`apps/web/src/components/conversation-runtime/session/session-runtime.ts`）**同构**：
 * 同样的四类信号，同样的「任一命中即视为活跃」语义。两侧必须保持一致，否则会出现
 * 「web 认为该轮询、移动端认为不该轮询」的口径漂移。
 *
 * 存在的理由：这个 effect 过去只用 `accessToken` 作为门控，于是空闲会话也每 10 秒拉
 * 一次完整 `/status`（子树会话 + tasks 合并 + todo + pending + workflowRuntime），
 * 而全部产出只是挂件上两个徽标数字。空闲时这些数据一个字节都不会变。
 */

/** 与 `SessionTodoItem['status']` 对齐；`temp` 与 `main` 同构，一并考虑。 */
export type MobileTodoStatus = 'cancelled' | 'completed' | 'in_progress' | 'pending';

export interface MobileTodoLaneItem {
  status: MobileTodoStatus;
}

export interface MobileStatusActivityInput {
  /**
   * 服务端 `session_runtime_threads` 的新鲜心跳——它说没有流，就是真没有。
   * 声明为 `unknown`：这里只取它的真值，不关心内部字段。
   */
  activeStream: unknown;
  pendingPermissionCount: number;
  /** `pending` / `in_progress` 的 todo 数（挂件徽标用的就是这个口径）。 */
  pendingTodoCount: number;
  /**
   * 本地是否持有活跃任务。移动端没有 `sessionTasks` 数组，用子代理活动近似
   * （与 `taskSyncIntervalMs` 复用同一个信号）。
   */
  hasRunningLocalWork: boolean;
  /** 本地流式发送中。 */
  sending: boolean;
  taskStatuses: readonly string[];
}

/**
 * 会话是否存在「值得 1.8 秒级轮询」的活跃信号。
 *
 * 注意 `activeStream` 会被判为权威：服务端运行时心跳过期后该字段变 `null`，
 * 所以它为 null 时其余信号仍要独立成立——不能因为「服务端说没流」就忽略本地
 * 正在发送的事实。
 */
export function isMobileSessionRuntimeActive(input: MobileStatusActivityInput): boolean {
  return (
    input.sending ||
    input.hasRunningLocalWork ||
    Boolean(input.activeStream) ||
    input.pendingPermissionCount > 0 ||
    input.pendingTodoCount > 0 ||
    input.taskStatuses.some((status) => status === 'pending' || status === 'running')
  );
}
