export interface AuditEntry {
  id: string;
  action: string;
  toolName?: string;
  userId?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  redacted?: boolean;
}

export interface AuditLogFilter {
  since?: number;
  action?: string;
  limit?: number;
}

export interface AuditLogManagerInterface {
  append(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void;
  list(filter?: AuditLogFilter): AuditEntry[];
  export(format: 'json' | 'csv'): string;
}

const SENSITIVE_KEY_PATTERN = /password|token|secret|key/i;

function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    result[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : v;
  }
  return result;
}

function generateId(): string {
  return `al_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class AuditLogManager implements AuditLogManagerInterface {
  private entries: AuditEntry[] = [];

  append(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
    const redactedMetadata = entry.metadata ? redactMetadata(entry.metadata) : undefined;
    const hasRedactions =
      entry.metadata !== undefined &&
      Object.keys(entry.metadata).some((k) => SENSITIVE_KEY_PATTERN.test(k));

    this.entries.push({
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
      metadata: redactedMetadata,
      redacted: hasRedactions || entry.redacted,
    });
  }

  list(filter?: AuditLogFilter): AuditEntry[] {
    let result = this.entries;

    if (filter?.since !== undefined) {
      result = result.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter?.action !== undefined) {
      result = result.filter((e) => e.action === filter.action);
    }
    if (filter?.limit !== undefined) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  export(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return JSON.stringify(this.entries, null, 2);
    }

    const headers = ['id', 'action', 'toolName', 'userId', 'timestamp', 'redacted'];
    const rows = this.entries.map((e) =>
      [
        e.id,
        e.action,
        e.toolName ?? '',
        e.userId ?? '',
        String(e.timestamp),
        String(e.redacted ?? false),
      ]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }
}
