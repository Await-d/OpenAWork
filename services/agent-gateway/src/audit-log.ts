import { sqliteRun } from './db.js';

export type AuditErrorCategory = 'tool' | 'llm' | 'stream' | 'route';

export interface WriteAuditLogOptions {
  sessionId: string | null;
  category: AuditErrorCategory;
  /**
   * tool → 工具名（`file_edit`）
   * llm  → `QUOTA_EXCEEDED` / `RATE_LIMIT` / `MODEL_ERROR`
   * stream → `PARSE_ERROR` / `STREAM_ERROR`
   * route → `MODEL_RESOLVE` / `SESSION_CONFLICT` / `REPLAY_FAILED`
   */
  sourceName: string;
  requestId: string;
  input?: unknown;
  /** 需包含 `message` 字段以被前端 `extractAuditSummary` 正确提取 */
  output?: unknown;
  isError?: boolean;
  durationMs?: number | null;
}

/**
 * category + sourceName → `tool_name` 列值。
 * tool 类保持原样，其他加前缀（`llm:QUOTA_EXCEEDED`）以支持前端按类型分组。
 */
function resolveToolNameColumn(category: AuditErrorCategory, sourceName: string): string {
  if (category === 'tool') {
    return sourceName;
  }
  if (sourceName.startsWith(`${category}:`)) {
    return sourceName;
  }
  return `${category}:${sourceName}`;
}

function safeStringify(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  const fallback = (): string => {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    if (value instanceof Error) {
      return value.stack ?? value.message;
    }
    return Object.prototype.toString.call(value);
  };

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string') {
      return serialized;
    }
    if (typeof value === 'function') {
      return value.name.length > 0 ? `[Function: ${value.name}]` : '[Function]';
    }
    return null;
  } catch {
    return fallback();
  }
}

export function writeAuditLog(options: WriteAuditLogOptions): void {
  try {
    sqliteRun(
      'INSERT INTO audit_logs (session_id, tool_name, request_id, input_json, output_json, is_error, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        options.sessionId,
        resolveToolNameColumn(options.category, options.sourceName),
        options.requestId,
        safeStringify(options.input),
        safeStringify(options.output),
        (options.isError ?? true) ? 1 : 0,
        options.durationMs ?? null,
      ],
    );
  } catch {
    // 审计写入不阻塞主流程
  }
}
