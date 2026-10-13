import React from 'react';
import type {
  DevtoolsChannelAuditRecord,
  DevtoolsChannelRecord,
  DevtoolsSourceState,
} from '../state/settings-types.js';
import {
  InlineFailureNotice,
  rowInteractionProps,
  subtleButtonInteractionProps,
} from './devtools-workbench-primitives.js';
import {
  BADGE,
  BG,
  BS,
  CARD,
  CODE_BLOCK,
  LIST_CONTAINER,
  SEARCH_INPUT,
  ST,
  TWO_COLUMN,
  LEFT_PANEL,
  RIGHT_PANEL,
} from '../shared/settings-section-styles.js';

interface DevtoolsChannelSectionProps {
  sourceState: DevtoolsSourceState;
  channels: DevtoolsChannelRecord[];
  auditLogs: DevtoolsChannelAuditRecord[];
  selectedChannelId: string | null;
  query: string;
  onSetQuery: (value: string) => void;
  onSelectChannel: (channelId: string) => void;
  onClear: () => Promise<void>;
}

const GHOST_INTERACTION = subtleButtonInteractionProps();

/** `channel_run` / `channel_start` 等来源码 → 人类可读标签。 */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  channel_run: '会话运行',
  channel_start: '服务启动',
  channel_stop: '服务停止',
  channel_restart: '自动重启',
  channel_inbound: '入站处理',
  channel_queue: '队列拒绝',
  channel_delivery: '回复投递',
  channel_dispatch: '事件分发',
};

function formatSource(source: string | null): string {
  if (!source) return '未知来源';
  return SOURCE_LABELS[source] ?? source;
}

function formatEpochMs(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

/**
 * 解析后端返回的 ISO UTC 时间串。
 *
 * 后端已保证标准形态带 `Z`（`toIsoUtc`），这里只兜住无法解析的脏数据 ——
 * 返回 null 让展示层落到「—」占位，而不是渲染出 `Invalid Date`。
 */
function parseIsoUtcToEpoch(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesChannelQuery(channel: DevtoolsChannelRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return [
    channel.channelId,
    channel.channelType ?? '',
    channel.lastError ?? '',
    channel.lastErrorSource ?? '',
    channel.lastMessageChatId ?? '',
    channel.lastInboundError ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalized);
}

function matchesAuditQuery(log: DevtoolsChannelAuditRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return [log.channelId ?? '', log.code ?? '', log.message, log.source ?? '', log.toolName]
    .join(' ')
    .toLowerCase()
    .includes(normalized);
}

/** 有故障标记的频道排前面，其余按最近故障时间倒序。 */
function sortChannels(channels: readonly DevtoolsChannelRecord[]): DevtoolsChannelRecord[] {
  return [...channels].sort((left, right) => {
    const leftFailed = left.lastError === null ? 1 : 0;
    const rightFailed = right.lastError === null ? 1 : 0;
    if (leftFailed !== rightFailed) return leftFailed - rightFailed;
    return (
      (right.lastErrorAt ?? right.lastMessageAt ?? 0) -
      (left.lastErrorAt ?? left.lastMessageAt ?? 0)
    );
  });
}

/** 一行「标签 : 值」的只读字段。值缺省时显示占位符而非空白。 */
function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  const hasValue = typeof value === 'string' && value.length > 0;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
      <span style={{ ...ST, flexShrink: 0, minWidth: 76 }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          color: hasValue ? 'var(--fg-default)' : 'var(--fg-subtle)',
          fontFamily: mono ? 'var(--font-mono, monospace)' : undefined,
          wordBreak: 'break-word',
          minWidth: 0,
        }}
      >
        {hasValue ? value : '—'}
      </span>
    </div>
  );
}

export function DevtoolsChannelSection({
  sourceState,
  channels,
  auditLogs,
  selectedChannelId,
  query,
  onSetQuery,
  onSelectChannel,
  onClear,
}: DevtoolsChannelSectionProps) {
  const visibleChannels = sortChannels(
    channels.filter((channel) => matchesChannelQuery(channel, query)),
  );
  const visibleLogs = auditLogs.filter((log) => matchesAuditQuery(log, query));
  const faultyChannelCount = channels.filter((channel) => channel.lastError !== null).length;
  const selectedChannel =
    visibleChannels.find((channel) => channel.channelId === selectedChannelId) ??
    visibleChannels[0] ??
    null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      {/* 概览 + 工具栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={ST}>消息频道路障</span>
          <span
            style={{
              ...BADGE,
              color: faultyChannelCount > 0 ? 'var(--danger)' : 'var(--fg-muted)',
            }}
          >
            {faultyChannelCount} 个频道带故障标记
          </span>
          <span style={{ ...BADGE, color: 'var(--fg-muted)' }}>
            {visibleLogs.length} 条错误留痕
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
            数据来自 {sourceState.endpoint}，进程重启后仍可查
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(event) => onSetQuery(event.target.value)}
            autoComplete="off"
            placeholder="搜索频道 / 错误码 / 错误摘要"
            aria-label="搜索频道排障信息"
            style={{
              ...SEARCH_INPUT,
              flex: '0 1 240px',
              border: `1px solid ${query ? 'var(--accent)' : 'var(--border-default)'}`,
            }}
          />
          <button
            type="button"
            onClick={() => {
              void onClear();
            }}
            {...GHOST_INTERACTION}
            style={{
              ...BS,
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 12,
              color: 'var(--fg-default)',
            }}
          >
            清空留痕
          </button>
        </div>
      </div>

      {sourceState.status === 'error' && sourceState.error && (
        <InlineFailureNotice title="频道路障信息加载失败" message={sourceState.error} />
      )}

      {sourceState.status === 'loading' && channels.length === 0 && auditLogs.length === 0 ? (
        <div
          style={{
            ...CARD,
            padding: 20,
            textAlign: 'center',
            color: 'var(--fg-muted)',
            fontSize: 12,
          }}
        >
          正在加载频道路障信息…
        </div>
      ) : channels.length === 0 && auditLogs.length === 0 ? (
        <div
          style={{
            ...CARD,
            padding: 20,
            textAlign: 'center',
            color: 'var(--fg-muted)',
            fontSize: 12,
          }}
        >
          {sourceState.detail}
        </div>
      ) : (
        <>
          <div style={TWO_COLUMN}>
            {/* 左：频道健康快照 */}
            <div style={LEFT_PANEL}>
              <div style={{ ...ST, marginBottom: 8 }}>频道健康快照</div>
              <div style={{ ...LIST_CONTAINER, maxHeight: 360 }}>
                {visibleChannels.length === 0 ? (
                  <div
                    style={{
                      padding: 16,
                      fontSize: 12,
                      color: 'var(--fg-subtle)',
                      textAlign: 'center',
                    }}
                  >
                    没有匹配的频道
                  </div>
                ) : (
                  visibleChannels.map((channel) => {
                    const isActive = selectedChannel?.channelId === channel.channelId;
                    const hasError = channel.lastError !== null;
                    return (
                      <button
                        key={channel.channelId}
                        type="button"
                        onClick={() => onSelectChannel(channel.channelId)}
                        {...rowInteractionProps({ isActive, restBackground: 'transparent' })}
                        style={{
                          borderRadius: 8,
                          padding: '8px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          cursor: 'pointer',
                          textAlign: 'left',
                          minWidth: 0,
                          border: isActive
                            ? '1px solid var(--border-default)'
                            : '1px solid transparent',
                          background: isActive ? 'var(--bg-raised)' : 'transparent',
                          boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                          color: 'var(--fg-strong)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            alignItems: 'center',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: isActive ? 500 : 400,
                              fontFamily: 'var(--font-mono, monospace)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              minWidth: 0,
                            }}
                          >
                            {channel.channelType ?? '未知类型'} · {channel.channelId}
                          </span>
                          <span
                            style={{
                              ...BADGE,
                              flexShrink: 0,
                              fontSize: 10,
                              color: hasError ? 'var(--danger)' : 'var(--success, var(--fg-muted))',
                            }}
                          >
                            {hasError ? '故障' : '正常'}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            color: hasError ? 'var(--fg-default)' : 'var(--fg-subtle)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            lineHeight: 1.4,
                          }}
                        >
                          {hasError
                            ? channel.lastError
                            : `最后入站 ${formatEpochMs(channel.lastInboundAt)}`}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* 右：选中频道详情 */}
            <div style={RIGHT_PANEL}>
              <div style={{ ...ST, marginBottom: 8 }}>频道详情</div>
              {!selectedChannel ? (
                <div
                  style={{
                    padding: 16,
                    fontSize: 12,
                    color: 'var(--fg-subtle)',
                    textAlign: 'center',
                  }}
                >
                  请选择左侧频道查看详情
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                  <Field label="频道 ID" value={selectedChannel.channelId} mono />
                  <Field label="平台类型" value={selectedChannel.channelType} />
                  <Field label="运行状态" value={selectedChannel.status} />
                  <Field label="故障来源" value={formatSource(selectedChannel.lastErrorSource)} />
                  <Field label="故障时间" value={formatEpochMs(selectedChannel.lastErrorAt)} />
                  <Field label="最后消息" value={formatEpochMs(selectedChannel.lastMessageAt)} />
                  <Field label="消息会话" value={selectedChannel.lastMessageChatId} mono />
                  <Field
                    label="最后入站"
                    value={
                      selectedChannel.lastInboundAt === null
                        ? null
                        : `${formatEpochMs(selectedChannel.lastInboundAt)} · ${
                            selectedChannel.lastInboundAccepted === true ? '已接受' : '已忽略'
                          }`
                    }
                  />
                  <Field label="入站类型" value={selectedChannel.lastInboundType} />
                  <Field label="入站错误" value={selectedChannel.lastInboundError} />
                  {selectedChannel.lastError !== null && (
                    <div style={{ ...BG, borderRadius: 6, padding: 10 }}>
                      <div style={{ ...ST, marginBottom: 6 }}>当前故障摘要</div>
                      <pre style={{ ...CODE_BLOCK, margin: 0, whiteSpace: 'pre-wrap' }}>
                        {selectedChannel.lastError}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 错误留痕流水 */}
          <div>
            <div style={{ ...ST, marginBottom: 8 }}>错误留痕（按时间倒序）</div>
            <div style={{ ...LIST_CONTAINER, maxHeight: 420 }}>
              {visibleLogs.length === 0 ? (
                <div
                  style={{
                    padding: 16,
                    fontSize: 12,
                    color: 'var(--fg-subtle)',
                    textAlign: 'center',
                  }}
                >
                  {auditLogs.length === 0 ? '暂无错误留痕' : '没有匹配的错误留痕'}
                </div>
              ) : (
                visibleLogs.map((log) => <ChannelAuditRow key={log.id} log={log} />)
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 单条错误留痕。
 *
 * 堆栈默认折叠：它常有几十 KB，直接铺开会把整页变成日志墙，反而让人找不到
 * 真正要看的那一行。用 `<details>` 而不是受控 state —— 无需为它引入额外
 * 状态与重渲染。
 */
function ChannelAuditRow({ log }: { log: DevtoolsChannelAuditRecord }) {
  return (
    <div
      style={{
        ...CARD,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...BADGE, color: 'var(--danger)', fontSize: 10 }}>
          {log.code ?? 'UNKNOWN'}
        </span>
        <span style={{ ...BADGE, color: 'var(--fg-muted)', fontSize: 10 }}>
          {formatSource(log.source)}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--fg-subtle)',
            fontFamily: 'var(--font-mono, monospace)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {log.channelId ?? '未知频道'} · {formatEpochMs(parseIsoUtcToEpoch(log.createdAt))}
        </span>
        {log.sessionId !== null && (
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-subtle)',
              fontFamily: 'var(--font-mono, monospace)',
              flexShrink: 0,
            }}
          >
            会话 {log.sessionId.slice(0, 8)}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-strong)', wordBreak: 'break-word' }}>
        {log.message}
      </div>
      {log.stack !== null && (
        <details style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          <summary style={{ cursor: 'pointer' }}>展开调用栈</summary>
          <pre
            style={{
              ...CODE_BLOCK,
              margin: '6px 0 0',
              maxHeight: 260,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {log.stack}
          </pre>
        </details>
      )}
    </div>
  );
}
