import type { FocusEvent, MouseEvent } from 'react';
import type { WorkerEntry } from '@openAwork/shared-ui';
import type {
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from '../state/settings-types.js';
import { formatUpstreamStreamSummary } from '../state/settings-derived.js';

/**
 * 列表行 / 卡片的 hover 与 focus 反馈。
 *
 * devtools 的分区内容全部使用内联样式，没有 CSS 伪类可用，因此用事件回调直接改
 * DOM 样式（与 `optimized-settings-layout.tsx` 的侧边导航项同一模式）。
 * 选中行不参与 hover 覆盖，避免把选中态的背景冲掉。
 */
export function rowInteractionProps(options: {
  isActive: boolean;
  restBackground: string;
  hoverBackground?: string;
}) {
  const { isActive, restBackground, hoverBackground = 'var(--bg-hover)' } = options;

  return {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      if (!isActive) {
        event.currentTarget.style.background = hoverBackground;
      }
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      if (!isActive) {
        event.currentTarget.style.background = restBackground;
      }
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      event.currentTarget.style.outline = '2px solid var(--accent)';
      event.currentTarget.style.outlineOffset = '2px';
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      event.currentTarget.style.outline = 'none';
    },
  };
}

/** 透明底次级按钮的 hover / focus 反馈；主色按钮请改用滤镜式反馈或状态样式。 */
export function subtleButtonInteractionProps(restBackground = 'transparent') {
  return {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      event.currentTarget.style.background = 'var(--bg-hover)';
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      event.currentTarget.style.background = restBackground;
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      event.currentTarget.style.outline = '2px solid var(--accent)';
      event.currentTarget.style.outlineOffset = '2px';
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      event.currentTarget.style.outline = 'none';
    },
  };
}

/** 实心按钮（主色 / 危险色）的 hover 反馈：提亮而不改背景声明，避免 shorthand 冲突。 */
export const SOLID_BUTTON_INTERACTION = {
  onMouseEnter: (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.style.filter = 'brightness(1.08)';
  },
  onMouseLeave: (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.style.filter = 'none';
  },
  onFocus: (event: FocusEvent<HTMLElement>) => {
    event.currentTarget.style.outline = '2px solid var(--accent)';
    event.currentTarget.style.outlineOffset = '2px';
  },
  onBlur: (event: FocusEvent<HTMLElement>) => {
    event.currentTarget.style.outline = 'none';
  },
};

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
        background: 'var(--bg-overlay)',
        border: 'var(--border-subtle)',
        text: 'var(--accent)',
        badgeBackground: 'var(--accent-subtle)',
      };
    case 'error':
      return {
        background: 'color-mix(in srgb, var(--danger) 6%, var(--bg-overlay))',
        border: 'var(--danger-border)',
        text: 'var(--danger)',
        badgeBackground: 'var(--danger-muted)',
      };
    case 'empty':
      return {
        background: 'var(--bg-overlay)',
        border: 'var(--border-subtle)',
        text: 'var(--fg-muted)',
        badgeBackground: 'var(--bg-raised)',
      };
    case 'unavailable':
      return {
        background: 'color-mix(in srgb, var(--warning) 6%, var(--bg-overlay))',
        border: 'var(--warning-border)',
        text: 'var(--warning)',
        badgeBackground: 'var(--warning-muted)',
      };
    default:
      return {
        background: 'var(--bg-overlay)',
        border: 'var(--border-subtle)',
        text: 'var(--fg-muted)',
        badgeBackground: 'var(--bg-raised)',
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
        border: '1px solid var(--danger-border)',
        background: 'color-mix(in srgb, var(--danger) 6%, var(--bg-overlay))',
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)' }}>{title}</div>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--fg-default)',
          wordBreak: 'break-word',
        }}
      >
        {message}
      </div>
    </div>
  );
}

const CARD_GHOST_INTERACTION = subtleButtonInteractionProps();

export function SourceOverviewCard({
  source,
  onRefresh,
}: {
  source: DevtoolsSourceState;
  onRefresh?: () => void;
}) {
  const tone = getSourceTone(source.status);
  const isLoading = source.status === 'loading';

  return (
    <div
      style={{
        background: tone.background,
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--fg-strong)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {source.label}
        </span>
        <span
          style={{
            flexShrink: 0,
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            color: tone.text,
            background: tone.badgeBackground,
          }}
        >
          {getSourceStatusLabel(source.status)}
        </span>
      </div>

      <div
        title={source.endpoint}
        style={{
          fontSize: 11,
          color: 'var(--fg-muted)',
          fontFamily: 'var(--font-mono, monospace)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {source.endpoint}
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--fg-default)' }}>
        {source.detail}
      </div>

      {source.error && (
        <div
          style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--danger)', wordBreak: 'break-word' }}
        >
          {source.error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 'auto',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {formatUpdatedAt(source.updatedAt)}
          {source.count !== null ? ` · ${source.count} 条` : ''}
        </span>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={`刷新${source.label}`}
            {...CARD_GHOST_INTERACTION}
            style={{
              appearance: 'none',
              font: 'inherit',
              fontSize: 11,
              fontWeight: 500,
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-default)',
              background: 'transparent',
              color: 'var(--fg-default)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            {isLoading ? '刷新中…' : '刷新'}
          </button>
        )}
      </div>
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
          borderRadius: 10,
          border: '1px dashed var(--border-default)',
          padding: '16px 14px',
          color: 'var(--fg-muted)',
          fontSize: 12,
          lineHeight: 1.5,
          background: 'var(--bg-overlay)',
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
        border: '1px solid var(--danger-border)',
        background: 'color-mix(in srgb, var(--danger) 6%, var(--bg-overlay))',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>
            {diagnostic.message}
          </div>
          <div
            style={{
              display: 'flex',
              gap: '4px 12px',
              flexWrap: 'wrap',
              fontSize: 12,
              color: 'var(--fg-muted)',
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
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--danger)',
            background: 'var(--danger-muted)',
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
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)' }}>
              {entry.label}
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                color: 'var(--fg-default)',
                fontFamily: 'var(--font-mono, monospace)',
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
          borderRadius: 10,
          border: '1px dashed var(--border-default)',
          padding: '16px 14px',
          color: 'var(--fg-muted)',
          fontSize: 12,
          lineHeight: 1.5,
          background: 'var(--bg-overlay)',
        }}
      >
        选择一条日志后，这里会显示结构化执行详情。
      </div>
    );
  }

  const upstreamStreamSummary =
    log.source === 'stream:V2_UPSTREAM_STREAM_SUMMARY'
      ? formatUpstreamStreamSummary(log.output)
      : null;
  const summaryOutput =
    log.output && typeof log.output === 'object' && !Array.isArray(log.output)
      ? (log.output as Record<string, unknown>)
      : null;
  const isError = log.level === 'error';

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${isError ? 'var(--danger-border)' : 'var(--border-subtle)'}`,
        background: isError
          ? 'color-mix(in srgb, var(--danger) 6%, var(--bg-overlay))'
          : 'var(--bg-overlay)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>
            {log.message}
          </div>
          <div
            style={{
              display: 'flex',
              gap: '4px 12px',
              flexWrap: 'wrap',
              fontSize: 12,
              color: 'var(--fg-muted)',
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
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            color: isError ? 'var(--danger)' : 'var(--accent)',
            background: isError ? 'var(--danger-muted)' : 'var(--accent-subtle)',
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
        {upstreamStreamSummary && summaryOutput ? (
          <div
            style={{
              gridColumn: '1 / -1',
              borderRadius: 8,
              border: '1px solid var(--accent-border)',
              background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-overlay))',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)' }}>流式摘要</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>
              {upstreamStreamSummary}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: 8,
              }}
            >
              {[
                { label: '文本增量', value: summaryOutput['textDeltaCount'] },
                { label: '思考增量', value: summaryOutput['reasoningDeltaCount'] },
                { label: '工具增量', value: summaryOutput['toolCallDeltaCount'] },
                { label: '收到 done', value: summaryOutput['sawDone'] === true ? '是' : '否' },
                { label: '收到 error', value: summaryOutput['sawError'] === true ? '是' : '否' },
                { label: '发生 stall', value: summaryOutput['stalled'] === true ? '是' : '否' },
              ].map((entry) => (
                <div
                  key={entry.label}
                  style={{
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-base)',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{entry.label}</div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--fg-strong)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {String(entry.value ?? '0')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {[
          { label: '输入 payload', value: log.input },
          { label: '输出 payload', value: log.output },
        ].map((entry) => (
          <div
            key={entry.label}
            style={{
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)' }}>
              {entry.label}
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                color: 'var(--fg-default)',
                fontFamily: 'var(--font-mono, monospace)',
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
          borderRadius: 10,
          border: '1px dashed var(--border-default)',
          padding: '16px 14px',
          color: 'var(--fg-muted)',
          fontSize: 12,
          lineHeight: 1.5,
          background: 'var(--bg-overlay)',
        }}
      >
        选择一个 Worker 后，这里会显示状态详情与复制上下文。
      </div>
    );
  }

  const isError = worker.status === 'error';

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${isError ? 'var(--danger-border)' : 'var(--border-subtle)'}`,
        background: isError
          ? 'color-mix(in srgb, var(--danger) 6%, var(--bg-overlay))'
          : 'var(--bg-overlay)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>
            {worker.name}
          </div>
          <div
            style={{
              display: 'flex',
              gap: '4px 12px',
              flexWrap: 'wrap',
              fontSize: 12,
              color: 'var(--fg-muted)',
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
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            color: isError ? 'var(--danger)' : 'var(--accent)',
            background: isError ? 'var(--danger-muted)' : 'var(--accent-subtle)',
          }}
        >
          {worker.status}
        </span>
      </div>

      <div
        style={{
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-base)',
          padding: '10px 12px',
          fontSize: 12,
          color: 'var(--fg-default)',
          lineHeight: 1.5,
        }}
      >
        {getWorkerRecommendation(worker)}
      </div>
    </div>
  );
}
