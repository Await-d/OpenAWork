import type { DevEvent, Diagnostic } from '@openAwork/shared-ui';
import type {
  DevtoolsSourceKey,
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from './settings-types.js';

export interface DiagnosticGroup {
  filePath: string;
  diagnostics: Diagnostic[];
}

const DEVTOOLS_SOURCE_DEFINITIONS: Record<
  DevtoolsSourceKey,
  Pick<DevtoolsSourceState, 'label' | 'endpoint' | 'status' | 'detail'>
> = {
  devLogs: {
    label: '开发日志',
    endpoint: '/settings/dev-logs',
    status: 'loading',
    detail: '正在拉取最近工具执行日志',
  },
  diagnostics: {
    label: '诊断信息',
    endpoint: '/settings/diagnostics',
    status: 'loading',
    detail: '正在聚合最近异常记录',
  },
  desktopAutomation: {
    label: '桌面自动化',
    endpoint: '/desktop-automation/status',
    status: 'loading',
    detail: '正在检查 sidecar 能力状态',
  },
  sshConnections: {
    label: 'SSH 连接',
    endpoint: '/ssh/connections',
    status: 'loading',
    detail: '正在拉取远程连接列表',
  },
  workers: {
    label: 'Worker 状态',
    endpoint: '/settings/workers',
    status: 'loading',
    detail: '正在检查 Worker 配置与运行状态',
  },
  githubTriggers: {
    label: 'GitHub 触发器',
    endpoint: '未接入真实配置源',
    status: 'unavailable',
    detail: 'GitHub 触发器配置尚未接入真实配置源。',
  },
  providerUpdates: {
    label: '提供商更新',
    endpoint: '未接入更新记录源',
    status: 'unavailable',
    detail: '暂无提供商更新记录。',
  },
};

const SUMMARY_KEYS = ['message', 'error', 'summary', 'detail', 'reason', 'stderr', 'text'] as const;

function truncateText(value: string, maxLength = 140): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function firstNonEmptyString(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

export function extractPrimaryMessage(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return payload.trim().length > 0 ? truncateText(payload.trim()) : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const message = extractPrimaryMessage(item);
      if (message) {
        return message;
      }
    }
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const direct = firstNonEmptyString(
    SUMMARY_KEYS.map((key) => (typeof record[key] === 'string' ? String(record[key]) : null)),
  );
  if (direct) {
    return truncateText(direct);
  }

  if (Array.isArray(record['issues'])) {
    const firstIssue = record['issues'][0];
    const issueMessage = extractPrimaryMessage(firstIssue);
    if (issueMessage) {
      return truncateText(issueMessage);
    }
  }

  if (record['data']) {
    const nestedData = extractPrimaryMessage(record['data']);
    if (nestedData) {
      return truncateText(nestedData);
    }
  }

  return null;
}

function buildDevLogLabel(log: SettingsDevLogRecord): string {
  const payloadSummary = extractPrimaryMessage(log.output) ?? extractPrimaryMessage(log.input);
  if (payloadSummary) {
    return payloadSummary;
  }

  return log.message || `${log.source ?? 'tool'} 事件`;
}

export function buildDevEventsFromLogs(logs: SettingsDevLogRecord[]): DevEvent[] {
  return logs.map((log, index) => ({
    id: log.id ?? `dev-${log.timestamp}-${index}`,
    ts: log.timestamp,
    type: log.level === 'error' ? 'error' : 'raw',
    sessionId: log.sessionId ?? undefined,
    label: buildDevLogLabel(log),
    payload: {
      level: log.level,
      message: log.message,
      source: log.source,
      requestId: log.requestId,
      sessionId: log.sessionId,
      durationMs: log.durationMs,
      createdAt: log.createdAt,
      input: log.input,
      output: log.output,
    },
  }));
}

export function groupDiagnosticsByFile(diagnostics: SettingsDiagnosticRecord[]): DiagnosticGroup[] {
  const groups = new Map<string, Diagnostic[]>();

  for (const diagnostic of diagnostics) {
    const existing = groups.get(diagnostic.filePath) ?? [];
    existing.push({
      severity: diagnostic.severity,
      line: 1,
      col: 1,
      message: diagnostic.message,
      source: diagnostic.requestId ?? 'settings',
    });
    groups.set(diagnostic.filePath, existing);
  }

  return Array.from(groups.entries()).map(([filePath, groupedDiagnostics]) => ({
    filePath,
    diagnostics: groupedDiagnostics,
  }));
}

export function createInitialDevtoolsSourceStates(): Record<
  DevtoolsSourceKey,
  DevtoolsSourceState
> {
  return Object.fromEntries(
    Object.entries(DEVTOOLS_SOURCE_DEFINITIONS).map(([key, definition]) => [
      key,
      {
        ...definition,
        error: null,
        count: null,
        updatedAt: null,
      },
    ]),
  ) as Record<DevtoolsSourceKey, DevtoolsSourceState>;
}

export function buildAuditExportContent(
  logs: SettingsDevLogRecord[],
  format: 'json' | 'markdown',
): string {
  if (format === 'json') {
    return JSON.stringify(logs, null, 2);
  }

  const header =
    '| level | message | source | request_id | duration_ms | timestamp |\n| --- | --- | --- | --- | --- | --- |';
  const rows = logs.map((log) => {
    const timestamp = new Date(log.timestamp).toISOString();
    return [
      log.level,
      log.message,
      log.source ?? 'settings',
      log.requestId ?? '-',
      log.durationMs ?? '-',
      timestamp,
    ]
      .map((value) => String(value).replaceAll('|', '\\|'))
      .join(' | ');
  });

  return [header, ...rows.map((row) => `| ${row} |`)].join('\n');
}
