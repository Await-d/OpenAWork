import type { LogEntry, LogFilter, LogLevel } from './log-types.js';

export interface LogManager {
  log(level: LogLevel, message: string, source?: string, data?: unknown): void;
  debug(message: string, source?: string, data?: unknown): void;
  info(message: string, source?: string, data?: unknown): void;
  warn(message: string, source?: string, data?: unknown): void;
  error(message: string, source?: string, data?: unknown): void;
  tail(n: number, filter?: LogFilter): LogEntry[];
  follow(filter: LogFilter, callback: (entry: LogEntry) => void): () => void;
  filter(filter: LogFilter): LogEntry[];
  export(format: 'json' | 'text'): string;
  clear(): void;
}

const MAX_ENTRIES = 10000;
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function levelIndex(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (filter.level !== undefined && levelIndex(entry.level) < levelIndex(filter.level)) {
    return false;
  }
  if (filter.source !== undefined && entry.source !== filter.source) return false;
  if (filter.since !== undefined && entry.timestamp < filter.since) return false;
  return true;
}

export function createInMemoryLogManager(): LogManager {
  const buffer: LogEntry[] = [];
  const subscribers = new Set<{ filter: LogFilter; callback: (entry: LogEntry) => void }>();

  function addEntry(entry: LogEntry): void {
    if (buffer.length >= MAX_ENTRIES) {
      buffer.shift();
    }
    buffer.push(entry);
    for (const sub of subscribers) {
      if (matchesFilter(entry, sub.filter)) {
        sub.callback(entry);
      }
    }
  }

  function log(level: LogLevel, message: string, source?: string, data?: unknown): void {
    addEntry({ id: generateId(), level, message, timestamp: Date.now(), source, data });
  }

  return {
    log,
    debug: (message, source?, data?) => log('debug', message, source, data),
    info: (message, source?, data?) => log('info', message, source, data),
    warn: (message, source?, data?) => log('warn', message, source, data),
    error: (message, source?, data?) => log('error', message, source, data),

    tail(n: number, filter?: LogFilter): LogEntry[] {
      const matched = filter ? buffer.filter((e) => matchesFilter(e, filter)) : buffer.slice();
      return matched.slice(-n);
    },

    follow(filter: LogFilter, callback: (entry: LogEntry) => void): () => void {
      const sub = { filter, callback };
      subscribers.add(sub);
      return () => {
        subscribers.delete(sub);
      };
    },

    filter(f: LogFilter): LogEntry[] {
      const matched = buffer.filter((e) => matchesFilter(e, f));
      if (f.limit !== undefined) return matched.slice(-f.limit);
      return matched;
    },

    export(format: 'json' | 'text'): string {
      if (format === 'json') return JSON.stringify(buffer, null, 2);
      return buffer
        .map((e) => {
          const ts = new Date(e.timestamp).toISOString();
          const src = e.source ? ` [${e.source}]` : '';
          const data = e.data !== undefined ? ` ${JSON.stringify(e.data)}` : '';
          return `${ts} ${e.level.toUpperCase()}${src}: ${e.message}${data}`;
        })
        .join('\n');
    },

    clear(): void {
      buffer.length = 0;
    },
  };
}
