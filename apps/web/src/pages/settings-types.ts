import type { Diagnostic, LogEntry } from '@openAwork/shared-ui';

export type ReasoningEffortRef = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingModeRef {
  enabled: boolean;
  effort: ReasoningEffortRef;
}

export interface ThinkingDefaultsRef {
  chat: ThinkingModeRef;
  fast: ThinkingModeRef;
}

export interface ProviderEditData {
  name: string;
  type: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
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

export type DevtoolsSourceKey =
  | 'devLogs'
  | 'diagnostics'
  | 'desktopAutomation'
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
