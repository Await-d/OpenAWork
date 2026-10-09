/**
 * 灵动岛展示层类型与纯函数。
 *
 * 这里刻意不含任何 React / Tauri 依赖:纯计算便于单元测试(T-13),
 * 也让状态机边界(上游字符串 → 收敛枚举)只有一处真相。
 */

/** 灵动岛展示的 Agent 运行态。 */
export type IslandAgentState =
  'idle' | 'running' | 'tool-calling' | 'streaming' | 'paused' | 'completed' | 'error';

/** 网关健康态(与 Rust `GatewayHealth` 的 kebab-case 序列化一致)。 */
export type IslandGatewayHealth = 'stopped' | 'starting' | 'healthy' | 'restarting' | 'failed';

/** 状态点的视觉基调。 */
export type IslandTone = 'idle' | 'active' | 'done' | 'error';

export interface IslandStatusPresentation {
  label: string;
  tone: IslandTone;
}

/** 把上游任意值安全收敛为 `IslandAgentState`(未知值一律 `idle`)。 */
export function normalizeAgentState(value: unknown): IslandAgentState {
  switch (value) {
    case 'idle':
    case 'running':
    case 'tool-calling':
    case 'streaming':
    case 'paused':
    case 'completed':
    case 'error':
      return value;
    default:
      return 'idle';
  }
}

/** 把上游任意值安全收敛为 `IslandGatewayHealth`(未知值一律 `stopped`)。 */
export function normalizeGatewayHealth(value: unknown): IslandGatewayHealth {
  switch (value) {
    case 'stopped':
    case 'starting':
    case 'healthy':
    case 'restarting':
    case 'failed':
      return value;
    default:
      return 'stopped';
  }
}

/**
 * 计算灵动岛要展示的文案与色调。
 *
 * 优先级:网关未就绪(异常 / 停止 / 启动中)时先展示网关态 —— 此时 Agent 态
 * 没有可信来源;网关健康后才按 Agent 运行态展示。
 */
export function presentIslandStatus(
  agentState: IslandAgentState,
  health: IslandGatewayHealth,
): IslandStatusPresentation {
  if (health === 'failed') {
    return { label: '网关异常', tone: 'error' };
  }
  if (health === 'stopped') {
    return { label: '网关未运行', tone: 'idle' };
  }
  if (health === 'starting' || health === 'restarting') {
    return { label: '网关启动中', tone: 'active' };
  }

  switch (agentState) {
    case 'running':
      return { label: '思考中', tone: 'active' };
    case 'tool-calling':
      return { label: '调用工具', tone: 'active' };
    case 'streaming':
      return { label: '输出中', tone: 'active' };
    case 'paused':
      return { label: '等待确认', tone: 'active' };
    case 'completed':
      return { label: '已完成', tone: 'done' };
    case 'error':
      return { label: '出错', tone: 'error' };
    default:
      return { label: '待机', tone: 'idle' };
  }
}
