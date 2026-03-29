export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export type StepStatus = 'success' | 'pending' | 'error';

export interface WorkflowStep {
  name: string;
  status: StepStatus;
  message?: string;
  durationMs?: number;
  fields?: Record<string, string | number | boolean>;
  children?: WorkflowStep[];
  _startedAt?: number;
}

export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  ip?: string;
  userAgent?: string;
  startTime: number;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  args?: unknown[];
}

export interface LoggerOptions {
  level?: LogLevel;
  ringBufferSize?: number;
  prefix?: string;
}
