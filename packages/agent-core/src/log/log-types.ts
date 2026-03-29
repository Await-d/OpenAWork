export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  source?: string;
  data?: unknown;
}

export interface LogFilter {
  level?: LogLevel;
  source?: string;
  since?: number;
  limit?: number;
}
