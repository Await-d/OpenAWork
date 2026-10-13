import type { Diagnostic, LogEntry, SupportedReasoningEffort } from '@openAwork/shared-ui';

export type ReasoningEffortRef = SupportedReasoningEffort;

export interface ThinkingModeRef {
  enabled: boolean;
  effort: ReasoningEffortRef;
}

export interface ThinkingDefaultsRef {
  chat: ThinkingModeRef;
  fast: ThinkingModeRef;
}

export type SubagentModelMode = 'auto' | 'inherit-main';

export interface SubagentModelPolicyRef {
  modelMode: SubagentModelMode;
}

/** 子代理数量限制（用户级、设置页可调）。 */
export interface SubagentLimitsRef {
  /**
   * 同一任务树中同时活跃的子代理上限（默认 4）：统计运行中与待交互未终结的子代理，
   * 已完成 / 失败 / 取消即释放名额。
   */
  maxActivePerRoot: number;
  /** 子代理嵌套深度上限，主会话深度 0（默认 1）。 */
  maxNestingDepth: number;
}

export interface ProviderEditData {
  name: string;
  type: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  openaiFastMode?: boolean;
  upstreamProtocol?: 'chat_completions' | 'responses' | 'anthropic_messages';
}

export interface SettingsDevLogRecord extends LogEntry {
  id?: string;
  requestId?: string;
  sessionId?: string | null;
  durationMs?: number | null;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  createdAt?: string;
}

export interface SettingsDiagnosticRecord {
  filePath: string;
  message: string;
  severity: Diagnostic['severity'];
  requestId?: string;
  sessionId?: string | null;
  durationMs?: number | null;
  createdAt?: string;
  appVersion?: string;
  input?: unknown;
  output?: unknown;
  toolName?: string;
}

export interface SettingsVersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkError: string | null;
  checkedAt: string | null;
  checking: boolean;
}

export interface UpstreamRetrySettingsRef {
  maxRetries: number;
}

export type DevtoolsSourceKey =
  | 'devLogs'
  | 'diagnostics'
  | 'channelTroubleshooting'
  | 'desktopAutomation'
  | 'desktopControl'
  | 'sshConnections'
  | 'workers'
  | 'githubTriggers'
  | 'providerUpdates';

export type DevtoolsSourceStatus = 'loading' | 'healthy' | 'empty' | 'error' | 'unavailable';

export interface DevtoolsSourceState {
  label: string;
  endpoint: string;
  status: DevtoolsSourceStatus;
  detail: string;
  error: string | null;
  count: number | null;
  updatedAt: number | null;
}

/**
 * 消息频道路障数据。
 *
 * 刻意**不复用** `@openAwork/web-client` 的传输层类型作为页面 state：
 * 后端可能领先网关版本返回新字段，直接展开会让「多出来的字段」与
 * 「恰好为 undefined 的字段」在前端无法区分。展示层只需要这些窄化的视图字段。
 */
export interface DevtoolsChannelRecord {
  channelId: string;
  channelType: string | null;
  lastError: string | null;
  /** 后端 `lastErrorAt`，epoch 毫秒。 */
  lastErrorAt: number | null;
  lastErrorSource: string | null;
  lastInboundAccepted: boolean | null;
  lastInboundAt: number | null;
  lastInboundError: string | null;
  lastInboundType: string | null;
  lastMessageAt: number | null;
  lastMessageChatId: string | null;
  status: string | null;
}

export interface DevtoolsChannelAuditRecord {
  id: number;
  channelId: string | null;
  code: string | null;
  createdAt: string;
  message: string;
  sessionId: string | null;
  source: string | null;
  toolName: string;
  /** 完整堆栈；默认折叠，按需展开查看。 */
  stack: string | null;
}
