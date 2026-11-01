/**
 * 会话扩展面板的分区组件。
 *
 * 抽取原因：面板页原本是 ~400 行单函数，取数、状态、四段渲染与凭据表单全挤在一起，
 * 远超 `apps/web/AGENTS.md` 组件提取原则里「单块 >80 行 / 3 层以上嵌套必须提取」的门槛。
 * 这里只搬渲染，文案与 DOM 结构逐字保持——测试就锁在这些文案上。
 */

import type {
  SessionExtensionInheritance,
  SessionExtensionOperationSummary,
  SessionExtensionSecretMeta,
} from '@openAwork/web-client';
import {
  actionGroupStyle,
  formatTime,
  panelCardStyle,
  panelMutedStyle,
  panelRowStyle,
  statusLabel,
} from '../shared/session-extension-display.js';

/** 撤权动作的反馈文案：禁用是「停止使用」，移除是「不再存在」，两者语义必须分开。 */
export function revokeSuccessText(kind: 'skill' | 'mcp', remove: boolean): string {
  if (kind === 'skill') {
    return remove ? '已从本会话移除该技能。' : '已禁用该会话技能，新的调用会被拒绝。';
  }
  return remove ? '已从本会话移除该 MCP。' : '已禁用该 MCP；进行中的连接会被回收。';
}

export function InheritanceSection({
  inheritance,
  busy,
  blocked,
  isChannel,
  onSelect,
}: {
  inheritance: SessionExtensionInheritance;
  busy: boolean;
  /** 渠道只能收窄：放宽继承会让群成员用上会话所有者的用户级配置。 */
  blocked: boolean;
  isChannel: boolean;
  onSelect: (mode: SessionExtensionInheritance) => void;
}): React.ReactElement {
  return (
    <section style={panelCardStyle}>
      <div style={panelRowStyle}>
        <strong>继承策略</strong>
        <span style={panelMutedStyle}>
          {inheritance === 'inherit'
            ? '沿用用户级配置（可被会话条目覆盖）'
            : '只用会话自己的条目，不继承用户级配置'}
        </span>
      </div>
      <div style={actionGroupStyle}>
        {(['inherit', 'explicit'] as SessionExtensionInheritance[]).map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={busy || blocked || inheritance === mode}
            onClick={() => onSelect(mode)}
          >
            {mode === 'inherit' ? '继承用户级' : '只用会话条目'}
          </button>
        ))}
      </div>
      {isChannel && (
        <span style={panelMutedStyle}>
          渠道会话只能收窄为「只用会话条目」：放宽继承会让群成员用上会话所有者的用户级配置。
        </span>
      )}
    </section>
  );
}

/** 技能与 MCP 的条目行形状完全一致，合并成一个列表，避免两份几乎相同的 JSX。 */
export interface SessionEntry {
  resourceRef: string;
  label: string;
  enabled: boolean;
  /** 行内的附加标记（技能「已固定」/ MCP「引用凭据」）。 */
  extra?: string;
}

export function SessionEntryList({
  title,
  kind,
  emptyText,
  entries,
  busy,
  writable,
  footer,
  onRevoke,
}: {
  title: string;
  kind: 'skill' | 'mcp';
  emptyText: string;
  entries: SessionEntry[];
  busy: boolean;
  writable: boolean;
  footer?: string;
  onRevoke: (kind: 'skill' | 'mcp', resourceRef: string, remove: boolean) => void;
}): React.ReactElement {
  return (
    <section style={panelCardStyle}>
      <strong>{title}</strong>
      {entries.length === 0 && <span style={panelMutedStyle}>{emptyText}</span>}
      {entries.map((entry) => (
        <div key={entry.resourceRef} style={panelRowStyle}>
          <span>
            {entry.label}
            <span style={panelMutedStyle}>
              {' '}
              · {entry.enabled ? '已启用' : '已禁用'}
              {entry.extra ?? ''}
            </span>
          </span>
          <span style={actionGroupStyle}>
            <button
              type="button"
              disabled={busy || !writable || !entry.enabled}
              onClick={() => onRevoke(kind, entry.resourceRef, false)}
            >
              禁用
            </button>
            <button
              type="button"
              disabled={busy || !writable}
              onClick={() => onRevoke(kind, entry.resourceRef, true)}
            >
              移除
            </button>
          </span>
        </div>
      ))}
      {footer ? <span style={panelMutedStyle}>{footer}</span> : null}
    </section>
  );
}

export function SecretEditor({
  secrets,
  busy,
  writable,
  name,
  value,
  onNameChange,
  onValueChange,
  onSave,
  onDelete,
}: {
  secrets: SessionExtensionSecretMeta[];
  busy: boolean;
  writable: boolean;
  name: string;
  value: string;
  onNameChange: (next: string) => void;
  onValueChange: (next: string) => void;
  onSave: () => void;
  onDelete: (name: string) => void;
}): React.ReactElement {
  return (
    <section style={panelCardStyle}>
      <div style={panelRowStyle}>
        <strong>会话凭据</strong>
        <span style={panelMutedStyle}>只在这里录入；配置中仅保存引用，明文不回显、不入日志。</span>
      </div>
      {secrets.length === 0 && <span style={panelMutedStyle}>尚未录入任何凭据。</span>}
      {secrets.map((secret) => (
        <div key={secret.name} style={panelRowStyle}>
          <span>
            {secret.name}
            <span style={panelMutedStyle}> · 更新于 {formatTime(secret.updatedAt)}</span>
          </span>
          <button type="button" disabled={busy || !writable} onClick={() => onDelete(secret.name)}>
            删除
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          aria-label="凭据名称"
          placeholder="名称，如 api-key"
          value={name}
          disabled={busy || !writable}
          onChange={(event) => onNameChange(event.target.value)}
          style={{ minWidth: 180 }}
        />
        <input
          aria-label="凭据内容"
          placeholder="凭据内容（保存后不再显示）"
          type="password"
          value={value}
          disabled={busy || !writable}
          onChange={(event) => onValueChange(event.target.value)}
          style={{ minWidth: 240 }}
        />
        <button
          type="button"
          disabled={busy || !writable || name.length === 0 || value.length === 0}
          onClick={onSave}
        >
          保存凭据
        </button>
      </div>
      <span style={panelMutedStyle}>
        凭据不进入提案与审批链路，模型与渠道都拿不到它；轮换同一名称下的值即可让旧连接失效。
      </span>
    </section>
  );
}

export function PendingProposalList({
  pending,
  sessionId,
}: {
  pending: SessionExtensionOperationSummary[];
  sessionId: string;
}): React.ReactElement {
  return (
    <section style={panelCardStyle}>
      <strong>待确认提案</strong>
      {pending.length === 0 && <span style={panelMutedStyle}>没有待确认的提案。</span>}
      {pending.map((operation) => (
        <div key={operation.operationId} style={panelRowStyle}>
          <span>
            {operation.kind === 'skill' ? '技能' : 'MCP'} · {statusLabel(operation.status)}
            <span style={panelMutedStyle}> · 有效至 {formatTime(operation.expiresAt)}</span>
          </span>
          <a
            href={`/session-extensions/confirm?session=${encodeURIComponent(sessionId)}&operation=${encodeURIComponent(operation.operationId)}`}
          >
            前往确认
          </a>
        </div>
      ))}
    </section>
  );
}
