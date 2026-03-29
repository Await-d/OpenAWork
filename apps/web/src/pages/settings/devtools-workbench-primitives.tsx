import type { WorkerEntry } from '@openAwork/shared-ui';
import type {
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from '../settings-types.js';

type SourceTone = {
  background: string;
  border: string;
  text: string;
  badgeBackground: string;
};

function getSourceTone(status: DevtoolsSourceState['status']): SourceTone {
  switch (status) {
    case 'healthy':
      return {
        background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
        border: 'color-mix(in srgb, var(--accent) 35%, var(--border))',
        text: 'var(--accent)',
        badgeBackground: 'color-mix(in srgb, var(--accent) 18%, transparent)',
      };
    case 'error':
      return {
        background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
        border: 'color-mix(in srgb, var(--danger) 42%, var(--border))',
        text: 'var(--danger)',
        badgeBackground: 'color-mix(in srgb, var(--danger) 16%, transparent)',
      };
    case 'empty':
      return {
        background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
        border: 'var(--border)',
        text: 'var(--text-2)',
        badgeBackground: 'color-mix(in srgb, var(--text-3) 18%, transparent)',
      };
    case 'unavailable':
      return {
        background: 'color-mix(in srgb, var(--warning, #f59e0b) 10%, var(--surface))',
        border: 'color-mix(in srgb, var(--warning, #f59e0b) 30%, var(--border))',
        text: 'var(--warning, #f59e0b)',
        badgeBackground: 'color-mix(in srgb, var(--warning, #f59e0b) 16%, transparent)',
      };
    default:
      return {
        background: 'color-mix(in srgb, var(--surface) 85%, var(--bg))',
        border: 'var(--border)',
        text: 'var(--text-2)',
        badgeBackground: 'color-mix(in srgb, var(--text-3) 18%, transparent)',
      };
  }
}

function getSourceStatusLabel(status: DevtoolsSourceState['status']): string {
  switch (status) {
    case 'healthy':
      return '正常';
    case 'empty':
      return '暂无数据';
    case 'error':
      return '失败';
    case 'unavailable':
      return '未接入';
    default:
      return '载入中';
  }
}

function formatUpdatedAt(updatedAt: number | null): string {
  if (!updatedAt) {
    return '尚未完成';
  }

  return new Date(updatedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function InlineFailureNotice({ title, message }: { title: string; message: string }) {
  return (
    <div
      style={{
        border: '1px solid color-mix(in srgb, var(--danger) 42%, var(--border))',
        background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
        borderRadius: 8,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', wordBreak: 'break-word' }}>{message}</div>
    </div>
  );
}

export function SourceOverviewCard({
  source,
  onRefresh,
}: {
  source: DevtoolsSourceState;
  onRefresh?: () => void;
}) {
  const tone = getSourceTone(source.status);

  return (
    <div
      style={{
        background: tone.background,
        border: `1px solid ${tone.border}`,
        borderRadius: 8,
        padding: '7px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {source.label}
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-3)',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {source.endpoint}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              color: tone.text,
              background: tone.badgeBackground,
            }}
          >
            {getSourceStatusLabel(source.status)}
          </span>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={source.status === 'loading'}
              aria-label={`刷新${source.label}`}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '2px 7px',
                background: 'color-mix(in srgb, var(--surface) 90%, var(--bg))',
                color: 'var(--text)',
                fontSize: 10,
                cursor: source.status === 'loading' ? 'not-allowed' : 'pointer',
                opacity: source.status === 'loading' ? 0.55 : 1,
              }}
            >
              {source.status === 'loading' ? '…' : '刷新'}
            </button>
          ) : null}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.4 }}>{source.detail}</div>
      <div
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--text-3)' }}
      >
        <span>更新：{formatUpdatedAt(source.updatedAt)}</span>
        {source.count !== null ? <span>{source.count} 条</span> : null}
      </div>
      {source.error ? (
        <div
          style={{
            fontSize: 10,
            color: 'var(--danger)',
            fontFamily: 'monospace',
            wordBreak: 'break-word',
          }}
        >
          {source.error}
        </div>
      ) : null}
    </div>
  );
}

export function stringifyDetails(value: unknown): string {
  if (value === null || value === undefined) {
    return '无';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

export function buildDiagnosticKey(diagnostic: SettingsDiagnosticRecord): string {
  return [
    diagnostic.requestId ?? 'no-request-id',
    diagnostic.toolName ?? 'no-tool-name',
    diagnostic.filePath,
    diagnostic.sessionId ?? 'no-session-id',
    diagnostic.createdAt ?? 'no-created-at',
    diagnostic.durationMs ?? 'no-duration',
    diagnostic.message,
  ].join('::');
}

export function buildDiagnosticClipboardRecord(diagnostic: SettingsDiagnosticRecord) {
  return {
    toolName: diagnostic.toolName ?? diagnostic.filePath,
    filePath: diagnostic.filePath,
    severity: diagnostic.severity,
    message: diagnostic.message,
    requestId: diagnostic.requestId ?? null,
    sessionId: diagnostic.sessionId ?? null,
    durationMs: diagnostic.durationMs ?? null,
    createdAt: diagnostic.createdAt ?? null,
    input: diagnostic.input ?? null,
    output: diagnostic.output ?? null,
  };
}

export function buildDiagnosticClipboardPayload(diagnostic: SettingsDiagnosticRecord): string {
  return JSON.stringify(buildDiagnosticClipboardRecord(diagnostic), null, 2);
}

export function matchesDiagnosticQuery(
  diagnostic: SettingsDiagnosticRecord,
  query: string,
): boolean {
  const keyword = query.trim().toLowerCase();
  if (keyword.length === 0) {
    return true;
  }

  return [
    diagnostic.message,
    diagnostic.toolName,
    diagnostic.filePath,
    diagnostic.requestId,
    diagnostic.sessionId,
    stringifyDetails(diagnostic.output),
    stringifyDetails(diagnostic.input),
  ].some((field) =>
    String(field ?? '')
      .toLowerCase()
      .includes(keyword),
  );
}

export function DiagnosticDetailsPanel({
  diagnostic,
}: {
  diagnostic: SettingsDiagnosticRecord | null;
}) {
  if (!diagnostic) {
    return (
      <div
        style={{
          borderRadius: 8,
          border: '1px dashed var(--border)',
          padding: '10px 12px',
          color: 'var(--text-3)',
          fontSize: 11,
          background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
        }}
      >
        选择一条诊断记录后，这里会显示完整报错上下文。
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 10,
        border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--border))',
        background: 'color-mix(in srgb, var(--danger) 7%, var(--surface))',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {diagnostic.message}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 11,
              color: 'var(--text-3)',
            }}
          >
            <span>工具：{diagnostic.toolName ?? diagnostic.filePath}</span>
            {diagnostic.requestId ? <span>请求 ID：{diagnostic.requestId}</span> : null}
            {diagnostic.sessionId ? <span>会话：{diagnostic.sessionId}</span> : null}
            {typeof diagnostic.durationMs === 'number' ? (
              <span>耗时：{diagnostic.durationMs}ms</span>
            ) : null}
          </div>
        </div>
        <span
          style={{
            alignSelf: 'flex-start',
            padding: '4px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--danger)',
            background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
          }}
        >
          {diagnostic.severity}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
        }}
      >
        {[
          { label: '输入 payload', value: diagnostic.input },
          { label: '输出 / 错误 payload', value: diagnostic.output },
        ].map((entry) => (
          <div
            key={entry.label}
            style={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)' }}>
              {entry.label}
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                color: 'var(--text)',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 240,
                overflowY: 'auto',
              }}
            >
              {stringifyDetails(entry.value)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

export type DevtoolsSectionId = 'overview' | 'diagnostics' | 'logs' | 'ssh' | 'workers';

export function buildLogKey(log: SettingsDevLogRecord): string {
  return [
    log.requestId ?? 'no-request-id',
    log.source ?? 'no-source',
    log.sessionId ?? 'no-session-id',
    log.timestamp,
    log.message,
  ].join('::');
}

export function buildLogClipboardRecord(log: SettingsDevLogRecord) {
  return {
    level: log.level,
    source: log.source ?? null,
    message: log.message,
    requestId: log.requestId ?? null,
    sessionId: log.sessionId ?? null,
    durationMs: log.durationMs ?? null,
    createdAt: log.createdAt ?? null,
    timestamp: log.timestamp,
    input: log.input ?? null,
    output: log.output ?? null,
  };
}

export function buildLogClipboardPayload(log: SettingsDevLogRecord): string {
  return JSON.stringify(buildLogClipboardRecord(log), null, 2);
}

export function matchesLogQuery(log: SettingsDevLogRecord, query: string): boolean {
  const keyword = query.trim().toLowerCase();
  if (keyword.length === 0) {
    return true;
  }

  return [
    log.message,
    log.source,
    log.requestId,
    log.sessionId,
    stringifyDetails(log.input),
    stringifyDetails(log.output),
  ].some((field) =>
    String(field ?? '')
      .toLowerCase()
      .includes(keyword),
  );
}

export function findRelatedLogs(
  diagnostic: SettingsDiagnosticRecord | null,
  logs: SettingsDevLogRecord[],
): SettingsDevLogRecord[] {
  if (!diagnostic) {
    return [];
  }

  if (diagnostic.requestId) {
    const matchedByRequest = logs.filter((log) => log.requestId === diagnostic.requestId);
    if (matchedByRequest.length > 0) {
      return matchedByRequest;
    }
  }

  return logs.filter(
    (log) =>
      log.source === diagnostic.toolName ||
      log.source === diagnostic.filePath ||
      log.message.includes(diagnostic.filePath),
  );
}

export function LogDetailsPanel({ log }: { log: SettingsDevLogRecord | null }) {
  if (!log) {
    return (
      <div
        style={{
          borderRadius: 8,
          border: '1px dashed var(--border)',
          padding: '10px 12px',
          color: 'var(--text-3)',
          fontSize: 11,
          background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
        }}
      >
        选择一条日志后，这里会显示结构化执行详情。
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${log.level === 'error' ? 'color-mix(in srgb, var(--danger) 30%, var(--border))' : 'var(--border)'}`,
        background:
          log.level === 'error'
            ? 'color-mix(in srgb, var(--danger) 7%, var(--surface))'
            : 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{log.message}</div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 11,
              color: 'var(--text-3)',
            }}
          >
            <span>来源：{log.source ?? 'settings'}</span>
            {log.requestId ? <span>请求 ID：{log.requestId}</span> : null}
            {log.sessionId ? <span>会话：{log.sessionId}</span> : null}
            {typeof log.durationMs === 'number' ? <span>耗时：{log.durationMs}ms</span> : null}
          </div>
        </div>
        <span
          style={{
            alignSelf: 'flex-start',
            padding: '4px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            color: log.level === 'error' ? 'var(--danger)' : 'var(--accent)',
            background:
              log.level === 'error'
                ? 'color-mix(in srgb, var(--danger) 16%, transparent)'
                : 'color-mix(in srgb, var(--accent) 16%, transparent)',
          }}
        >
          {log.level}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
        }}
      >
        {[
          { label: '输入 payload', value: log.input },
          { label: '输出 payload', value: log.output },
        ].map((entry) => (
          <div
            key={entry.label}
            style={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)' }}>
              {entry.label}
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                color: 'var(--text)',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 240,
                overflowY: 'auto',
              }}
            >
              {stringifyDetails(entry.value)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

export function buildWorkerKey(worker: WorkerEntry): string {
  return worker.id;
}

export function buildWorkerClipboardRecord(worker: WorkerEntry) {
  return {
    id: worker.id,
    name: worker.name,
    mode: worker.mode ?? null,
    status: worker.status,
    endpoint: worker.endpoint ?? null,
  };
}

export function matchesWorkerQuery(worker: WorkerEntry, query: string): boolean {
  const keyword = query.trim().toLowerCase();
  if (keyword.length === 0) {
    return true;
  }

  return [worker.id, worker.name, worker.mode, worker.status, worker.endpoint].some((field) =>
    String(field ?? '')
      .toLowerCase()
      .includes(keyword),
  );
}

function getWorkerRecommendation(worker: WorkerEntry): string {
  switch (worker.status) {
    case 'error':
      return '当前 Worker 处于错误态。优先检查 endpoint 可达性、鉴权信息和最近一次任务执行日志。';
    case 'running':
      return '当前 Worker 正在运行，可结合开发日志与 requestId 继续排查上下文。';
    case 'stopped':
      return '当前 Worker 已停止，若需要恢复可先检查端点配置与上游服务可用性。';
    default:
      return '当前 Worker 空闲，可用于后续任务调试与连接验证。';
  }
}

export function WorkerDetailsPanel({ worker }: { worker: WorkerEntry | null }) {
  if (!worker) {
    return (
      <div
        style={{
          borderRadius: 8,
          border: '1px dashed var(--border)',
          padding: '10px 12px',
          color: 'var(--text-3)',
          fontSize: 11,
          background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
        }}
      >
        选择一个 Worker 后，这里会显示状态详情与复制上下文。
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${worker.status === 'error' ? 'color-mix(in srgb, var(--danger) 30%, var(--border))' : 'var(--border)'}`,
        background:
          worker.status === 'error'
            ? 'color-mix(in srgb, var(--danger) 7%, var(--surface))'
            : 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{worker.name}</div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 11,
              color: 'var(--text-3)',
            }}
          >
            <span>ID：{worker.id}</span>
            <span>模式：{worker.mode ?? 'unknown'}</span>
            <span>端点：{worker.endpoint ?? '未配置端点'}</span>
          </div>
        </div>
        <span
          style={{
            alignSelf: 'flex-start',
            padding: '4px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            color: worker.status === 'error' ? 'var(--danger)' : 'var(--accent)',
            background:
              worker.status === 'error'
                ? 'color-mix(in srgb, var(--danger) 16%, transparent)'
                : 'color-mix(in srgb, var(--accent) 16%, transparent)',
          }}
        >
          {worker.status}
        </span>
      </div>

      <div
        style={{
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--surface) 94%, var(--bg))',
          padding: '8px 10px',
          fontSize: 11,
          color: 'var(--text-2)',
          lineHeight: 1.5,
        }}
      >
        {getWorkerRecommendation(worker)}
      </div>
    </div>
  );
}
