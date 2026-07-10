import type { ChannelDiagnosticsEntry } from './channel-subscription-settings.types.js';

interface ChannelDiagnosticsPanelProps {
  readonly diagnostics?: ChannelDiagnosticsEntry;
  readonly disabled: boolean;
  readonly loading: boolean;
  readonly onRefresh?: () => void;
}

interface DiagnosticMetric {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'danger' | 'default' | 'success' | 'warning';
}

interface DiagnosticGroup {
  readonly title: string;
  readonly metrics: readonly DiagnosticMetric[];
}

export function ChannelDiagnosticsPanel({
  diagnostics,
  disabled,
  loading,
  onRefresh,
}: ChannelDiagnosticsPanelProps) {
  const groups = buildDiagnosticsGroups(diagnostics);

  return (
    <section className="channel-section">
      <div className="channel-section__head">
        <div>
          <h4 className="channel-section__title">运行诊断</h4>
          <div className="channel-muted">
            展示 Gateway 当前看到的连接、事件分发、消息入站与最近错误状态。
          </div>
        </div>
        {onRefresh ? (
          <button
            type="button"
            className="channel-button channel-button--ghost"
            disabled={disabled}
            onClick={onRefresh}
          >
            {loading ? '读取中…' : '刷新诊断'}
          </button>
        ) : null}
      </div>
      <div className="channel-section__body">
        {diagnostics ? (
          <div className="channel-diagnostics">
            {groups.map((group) => (
              <div key={group.title} className="channel-diagnostics__group">
                <div className="channel-diagnostics__group-title">{group.title}</div>
                <div className="channel-diagnostics__grid">
                  {group.metrics.map((metric) => (
                    <div
                      key={`${group.title}-${metric.label}`}
                      className={`channel-diagnostic-metric${
                        metric.tone ? ` is-${metric.tone}` : ''
                      }`}
                    >
                      <div className="channel-diagnostic-metric__label">{metric.label}</div>
                      <div className="channel-diagnostic-metric__value">{metric.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {diagnostics.note ? (
              <div className="channel-notice channel-notice--neutral">{diagnostics.note}</div>
            ) : null}
            {diagnostics.lastInboundError ? (
              <div className="channel-notice">
                <strong>入站错误：</strong>
                {diagnostics.lastInboundError}
              </div>
            ) : null}
            {diagnostics.lastSocketCloseReason ? (
              <div className="channel-notice channel-notice--neutral">
                <strong>最近断开：</strong>
                {diagnostics.lastSocketCloseReason}
              </div>
            ) : null}
            {diagnostics.lastError ? (
              <div className="channel-notice">
                <strong>运行错误：</strong>
                {diagnostics.lastError}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="channel-notice channel-notice--neutral">
            暂无诊断快照。保存并启动通道后，可点击刷新诊断查看 Gateway 状态。
          </div>
        )}
      </div>
    </section>
  );
}

function buildDiagnosticsGroups(
  diagnostics: ChannelDiagnosticsEntry | undefined,
): DiagnosticGroup[] {
  if (!diagnostics) {
    return [];
  }

  return [
    {
      title: '连接',
      metrics: [
        {
          label: '状态',
          value: diagnostics.status,
          tone: diagnostics.running
            ? 'success'
            : diagnostics.status === 'error'
              ? 'danger'
              : 'default',
        },
        { label: '传输', value: diagnostics.transport ?? '未上报' },
        {
          label: 'Identify',
          value:
            diagnostics.identified === undefined
              ? '未上报'
              : diagnostics.identified
                ? '已完成'
                : '未完成',
          tone: diagnostics.identified ? 'success' : undefined,
        },
        { label: 'READY', value: formatTimestamp(diagnostics.lastReadyAt) },
        { label: '心跳 ACK', value: formatTimestamp(diagnostics.lastHeartbeatAckAt) },
        { label: 'Socket 关闭', value: formatSocketClose(diagnostics) },
      ],
    },
    {
      title: '事件分发',
      metrics: [
        { label: '意图等级', value: diagnostics.currentIntent ?? '未上报' },
        { label: '意图说明', value: diagnostics.currentIntentDescription ?? '未上报' },
        { label: '最近分发', value: formatTimestamp(diagnostics.lastDispatchAt) },
        { label: '分发类型', value: diagnostics.lastDispatchType ?? '暂无' },
        { label: '忽略时间', value: formatTimestamp(diagnostics.lastIgnoredDispatchAt) },
        { label: '忽略类型', value: diagnostics.lastIgnoredDispatchType ?? '暂无' },
      ],
    },
    {
      title: '消息入站',
      metrics: [
        { label: '入站时间', value: formatTimestamp(diagnostics.lastInboundAt) },
        { label: '入站类型', value: diagnostics.lastInboundType ?? '暂无' },
        {
          label: '入站接受',
          value: formatAccepted(diagnostics.lastInboundAccepted),
          tone:
            diagnostics.lastInboundAccepted === undefined
              ? undefined
              : diagnostics.lastInboundAccepted
                ? 'success'
                : 'warning',
        },
        { label: '最近消息', value: formatTimestamp(diagnostics.lastMessageAt) },
        { label: '最近会话', value: diagnostics.lastMessageChatId ?? '暂无' },
        {
          label: '入站错误',
          value: diagnostics.lastInboundError ?? '暂无',
          tone: diagnostics.lastInboundError ? 'danger' : undefined,
        },
      ],
    },
    {
      title: '错误',
      metrics: [
        {
          label: '运行错误时间',
          value: formatTimestamp(diagnostics.lastErrorAt),
          tone: diagnostics.lastError ? 'danger' : undefined,
        },
        {
          label: '运行错误',
          value: diagnostics.lastError ?? '暂无',
          tone: diagnostics.lastError ? 'danger' : undefined,
        },
        {
          label: 'Socket 代码',
          value:
            diagnostics.lastSocketCloseCode === undefined
              ? '暂无'
              : String(diagnostics.lastSocketCloseCode),
        },
        { label: 'Socket 原因', value: diagnostics.lastSocketCloseReason ?? '暂无' },
      ],
    },
  ];
}

function formatAccepted(value: boolean | undefined): string {
  if (value === undefined) {
    return '未上报';
  }

  return value ? '已接受' : '已拒绝';
}

function formatSocketClose(diagnostics: ChannelDiagnosticsEntry): string {
  const closeAt = formatTimestamp(diagnostics.lastSocketCloseAt);
  if (diagnostics.lastSocketCloseCode === undefined) {
    return closeAt;
  }

  return `${closeAt} · ${diagnostics.lastSocketCloseCode}`;
}

function formatTimestamp(value: number | undefined): string {
  if (value === undefined) {
    return '暂无';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}
