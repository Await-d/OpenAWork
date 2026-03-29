import type { PermissionDecision } from '../permission/index.js';
import type { CompactionStrategy } from '../context/compact.js';

export type AuditEntryType =
  | 'message'
  | 'tool_call'
  | 'permission'
  | 'artifact'
  | 'model_switch'
  | 'compaction'
  | 'skill_install'
  | 'skill_uninstall';

export type AuditEntry =
  | { type: 'message'; role: 'user' | 'assistant'; contentHash: string; timestamp: number }
  | {
      type: 'tool_call';
      toolName: string;
      args: unknown;
      result: unknown;
      durationMs: number;
      isError: boolean;
      timestamp: number;
    }
  | {
      type: 'permission';
      toolName: string;
      scope: string;
      decision: PermissionDecision;
      reason: string;
      timestamp: number;
    }
  | { type: 'artifact'; name: string; path: string; sizeBytes: number; timestamp: number }
  | { type: 'model_switch'; fromModel: string; toModel: string; reason?: string; timestamp: number }
  | {
      type: 'compaction';
      strategy: CompactionStrategy;
      beforeTokens: number;
      afterTokens: number;
      timestamp: number;
    }
  | { type: 'skill_install'; skillId: string; version: string; sourceId: string; timestamp: number }
  | { type: 'skill_uninstall'; skillId: string; timestamp: number };

export interface AuditLogFilter {
  type?: AuditEntryType;
  from?: number;
  to?: number;
}

export interface AuditLogManager {
  append(sessionId: string, entry: AuditEntry): void;
  list(sessionId: string, filter?: AuditLogFilter): Promise<AuditEntry[]>;
  export(sessionId: string, format: 'json' | 'markdown'): Promise<string>;
  sanitize(content: string): string;
  clear(sessionId: string): Promise<void>;
}

const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
  /"apiKey"\s*:\s*"[^"]+"/g,
  /"password"\s*:\s*"[^"]+"/g,
  /"token"\s*:\s*"[^"]+"/g,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
];

function sanitize(content: string): string {
  let result = content;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function entryToMarkdown(entry: AuditEntry): string {
  const time = new Date(entry.timestamp).toISOString();
  switch (entry.type) {
    case 'message':
      return `- **${time}** [${entry.role}] hash:${entry.contentHash}`;
    case 'tool_call':
      return `- **${time}** [tool:${entry.toolName}] ${entry.isError ? '❌' : '✅'} ${entry.durationMs}ms`;
    case 'permission':
      return `- **${time}** [permission] ${entry.decision} for ${entry.toolName}:${entry.scope}`;
    case 'artifact':
      return `- **${time}** [artifact] ${entry.name} (${entry.sizeBytes}B) → ${entry.path}`;
    case 'model_switch':
      return `- **${time}** [model_switch] ${entry.fromModel} → ${entry.toModel}${entry.reason ? ` (${entry.reason})` : ''}`;
    case 'compaction':
      return `- **${time}** [compaction:${entry.strategy}] ${entry.beforeTokens} → ${entry.afterTokens} tokens`;
    case 'skill_install':
      return `- **${time}** [skill_install] ${entry.skillId}@${entry.version} from ${entry.sourceId}`;
    case 'skill_uninstall':
      return `- **${time}** [skill_uninstall] ${entry.skillId}`;
  }
}

export function createInMemoryAuditLogManager(): AuditLogManager {
  const store = new Map<string, AuditEntry[]>();

  return {
    append(sessionId: string, entry: AuditEntry): void {
      const entries = store.get(sessionId) ?? [];
      entries.push(entry);
      store.set(sessionId, entries);
    },

    async list(sessionId: string, filter?: AuditLogFilter): Promise<AuditEntry[]> {
      const entries = store.get(sessionId) ?? [];
      return entries.filter((e) => {
        if (filter?.type && e.type !== filter.type) return false;
        if (filter?.from && e.timestamp < filter.from) return false;
        if (filter?.to && e.timestamp > filter.to) return false;
        return true;
      });
    },

    async export(sessionId: string, format: 'json' | 'markdown'): Promise<string> {
      const entries = store.get(sessionId) ?? [];
      if (format === 'json') {
        return sanitize(JSON.stringify(entries, null, 2));
      }
      const lines = [
        `# Audit Log — Session ${sessionId}`,
        `Generated: ${new Date().toISOString()}`,
        `Entries: ${entries.length}`,
        '',
        ...entries.map(entryToMarkdown),
      ];
      return sanitize(lines.join('\n'));
    },

    sanitize(content: string): string {
      return sanitize(content);
    },

    async clear(sessionId: string): Promise<void> {
      store.delete(sessionId);
    },
  };
}
