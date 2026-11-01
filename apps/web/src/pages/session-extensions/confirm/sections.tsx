/**
 * 会话扩展确认页的分区组件。
 *
 * 抽取原因同面板：确认页原本把预览行构造、状态徽章、决策按钮、同类提案列表全写在
 * 一个函数里（`apps/web/AGENTS.md` 组件提取原则）。**预览行的字段白名单尤其重要**：
 * 它决定了「哪些东西会显示给用户看」，值得单独一个可读的函数，而不是散在 JSX 里。
 */

import type {
  SessionExtensionOperationDetail,
  SessionExtensionOperationSummary,
} from '@openAwork/web-client';
import {
  confirmLabelStyle,
  confirmMutedStyle,
  confirmValueStyle,
  confirmDangerValueStyle,
  formatTime,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusColor,
  statusLabel,
  warningListStyle,
} from '../shared/session-extension-display.js';

/**
 * 预览行 = 展示白名单。
 *
 * 只认这些键，且**不回显任何凭据明文**：`hasSecret` 只渲染成「已配置引用（不回显）」，
 * 端点只显示主机名（`endpointHost` 由网关侧脱敏后给出）。未知键不渲染，
 * 避免以后网关多回一个字段就把它漏到界面上。
 */
export function renderPreviewLines(
  preview: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = [];
  const read = (key: string): string | null => {
    const value = preview[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  const target = read('displayName') ?? read('skillId') ?? read('displayId');
  if (target) lines.push({ label: '目标', value: target });
  const source = read('sourceId');
  if (source) lines.push({ label: '来源', value: source });
  const version = read('version');
  if (version) lines.push({ label: '版本', value: version });
  const transport = read('transport');
  if (transport) lines.push({ label: '传输', value: transport });
  const host = read('endpointHost');
  if (host) lines.push({ label: '端点', value: host });
  const command = read('command');
  if (command) lines.push({ label: '命令', value: command });
  if (preview['hasSecret'] === true) lines.push({ label: '凭据', value: '已配置引用（不回显）' });
  if (preview['hasMcp'] === true)
    lines.push({ label: '内嵌 MCP', value: '是（将以本会话身份连接）' });
  if (preview['requiresLocalFiles'] === true) {
    lines.push({ label: '本地文件', value: '该技能需要本地文件，当前未部署，能力可能不可用' });
  }
  const scope = read('scope');
  if (scope) lines.push({ label: '生效范围', value: scope === 'session' ? '仅当前会话' : scope });
  const effectiveFrom = read('effectiveFrom');
  if (effectiveFrom) lines.push({ label: '生效时间', value: '确认成功后下一轮对话' });

  return lines;
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  return (
    <span
      style={{
        fontSize: 12,
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${statusColor(status)}`,
        color: statusColor(status),
      }}
    >
      {statusLabel(status)}
    </span>
  );
}

export function OperationPreview({
  sessionId,
  detail,
  inheritance,
}: {
  /** 取自链接参数，与详情里的 sessionId 同值；用显式入参避免两处来源漂移。 */
  sessionId: string;
  detail: SessionExtensionOperationDetail;
  /** 会话当前策略；读不到时不显示这一句（委托管理员可能无权限读状态）。 */
  inheritance: string | null;
}): React.ReactElement {
  const lines = renderPreviewLines(detail.preview);
  const warnings = Array.isArray(detail.preview['warnings'])
    ? (detail.preview['warnings'] as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  const expired = detail.expiresAt <= Date.now();

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <StatusBadge status={detail.status} />
        <span style={confirmMutedStyle}>请求时间：{formatTime(detail.requestedAt)}</span>
      </div>

      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', margin: 0 }}>
        {lines.map((line) => (
          <div key={line.label} style={{ display: 'contents' }}>
            <dt style={confirmLabelStyle}>{line.label}</dt>
            <dd style={confirmValueStyle}>{line.value}</dd>
          </div>
        ))}
        <dt style={confirmLabelStyle}>有效期至</dt>
        <dd style={expired ? confirmDangerValueStyle : confirmValueStyle}>
          {formatTime(detail.expiresAt)}
        </dd>
      </dl>

      {warnings.length > 0 ? (
        <ul style={warningListStyle}>
          {warnings.map((warning) => (
            <li key={warning} style={confirmValueStyle}>
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <p style={confirmMutedStyle}>
        影响范围：仅会话 {sessionId.slice(0, 18)}…；其他会话与用户级配置不受影响。
        {inheritance
          ? ` 当前策略：${inheritance === 'explicit' ? '仅用会话配置' : '继承用户配置'}。`
          : ''}
      </p>
    </>
  );
}

export function DecisionActions({
  status,
  expiresAt,
  hasNonce,
  busy,
  onDecide,
}: {
  status: string;
  expiresAt: number;
  hasNonce: boolean;
  busy: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
}): React.ReactElement {
  // 三个条件缺一不可：非待确认状态、已过期、没有本页持有的凭证，都不该发出决策请求。
  const disabled = busy || status !== 'pending_approval' || expiresAt <= Date.now() || !hasNonce;

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDecide('approve')}
        style={{ ...primaryButtonStyle, opacity: disabled ? 0.5 : 1 }}
      >
        确认并生效
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDecide('reject')}
        style={{ ...secondaryButtonStyle, opacity: disabled ? 0.5 : 1 }}
      >
        拒绝
      </button>
    </div>
  );
}

export function SiblingProposals({
  siblings,
}: {
  siblings: SessionExtensionOperationSummary[];
}): React.ReactElement | null {
  if (siblings.length === 0) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <p style={confirmLabelStyle}>同一会话的其他待处理提案</p>
      <ul style={warningListStyle}>
        {siblings.map((item) => (
          <li key={item.operationId} style={confirmValueStyle}>
            {item.kind === 'skill' ? '技能' : 'MCP'} · {item.resourceRef ?? item.operationId} ·{' '}
            {statusLabel(item.status)}
          </li>
        ))}
      </ul>
    </div>
  );
}
