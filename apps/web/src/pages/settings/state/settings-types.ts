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
  /** 同一任务树中同时运行的子代理上限（默认 4）。 */
  maxRunningPerRoot: number;
  /** 同一任务树下累计创建的子代理上限，含已完成（默认 24）。 */
  maxTotalPerRoot: number;
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
