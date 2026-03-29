import type { LogLevel, LogEntry, LoggerOptions } from './types.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  trace: '[TRC]',
  debug: '[DBG]',
  info: '[INF]',
  warn: '[WRN]',
  error: '[ERR]',
};

function timestamp(): string {
  const d = new Date();
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':');
}

export class FrontendLogger {
  private readonly minLevel: number;
  private readonly bufferSize: number;
  private readonly prefix: string;
  private buffer: LogEntry[] = [];

  constructor(options: LoggerOptions = {}) {
    const level: LogLevel = options.level ?? 'debug';
    this.minLevel = LEVEL_ORDER[level];
    this.bufferSize = options.ringBufferSize ?? 200;
    this.prefix = options.prefix ? `[${options.prefix}] ` : '';
  }

  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const entry: LogEntry = { level, message, timestamp: Date.now(), args };
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }
    const tag = `${this.prefix}${LEVEL_PREFIX[level]} [${timestamp()}]`;
    if (level === 'error') {
      console.error(tag, message, ...args);
    } else if (level === 'warn') {
      console.warn(tag, message, ...args);
    } else {
      console.log(tag, message, ...args);
    }
  }

  trace(message: string, ...args: unknown[]): void {
    this.log('trace', message, args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, args);
  }

  getLogs(): LogEntry[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }
}
