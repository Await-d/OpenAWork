import type { HandoffRecord } from '@openAwork/web-client';
import type { CSSProperties } from 'react';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import {
  resolveLayerProcessRecords,
  summarizeLayerProcessRecord,
  type LayerProcessRecord,
} from './layer-process-preview.js';

const ROOT_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '12px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
  flexShrink: 0,
};

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
};

const LIST_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const ITEM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 32%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 90%, var(--bg-base))',
};

const META_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 32%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 94%, var(--bg-base))',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 700,
};

function formatTime(timeMs: number): string {
  if (timeMs <= 0) {
    return '无时间';
  }
  return new Date(timeMs).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
}

function kindLabel(record: LayerProcessRecord): string {
  switch (record.kind) {
    case 'incoming':
      return '接收任务';
    case 'outgoing':
      return '继续下发';
    case 'related':
      return '关联记录';
  }
}

function renderDialogueRows(record: LayerProcessRecord) {
  const fields = [
    { label: '原始需求', value: record.preview.sourceIntent },
    { label: '改写任务', value: record.preview.rewrittenIntent },
    { label: '接手角色', value: record.preview.recommendedRole },
    { label: '下一步', value: record.preview.recommendedNextStep },
  ].filter((field) => field.value);

  if (fields.length === 0) {
    return null;
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {fields.map((field) => (
        <div key={field.label} style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)' }}>
            {field.label}
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.6 }}>
            {field.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface LayerProcessPanelProps {
  focusHandoffId?: string | null;
  records: HandoffRecord[];
  roleLayer: string | null | undefined;
  sessionId: string | null;
}

export function LayerProcessPanel({
  focusHandoffId = null,
  records,
  roleLayer,
  sessionId,
}: LayerProcessPanelProps) {
  const items = resolveLayerProcessRecords({
    focusHandoffId,
    records,
    sessionId,
  });

  if (items.length === 0) {
    return null;
  }

  const identity = getRoleLayerIdentity(roleLayer);

  return (
    <div style={ROOT_STYLE}>
      <div style={HEADER_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
          {identity.icon} 本轮过程回放
        </strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.55 }}>
          当前层级没有完整普通对话时，这里会优先补齐“谁下发给谁、这一层如何处理、又返回了什么”。
        </span>
      </div>
      <div style={LIST_STYLE}>
        {items.map((item) => {
          const fromIdentity = getRoleLayerIdentity(item.record.fromRoleLayer);
          const toIdentity = getRoleLayerIdentity(item.record.toRoleLayer);
          return (
            <div key={item.id} style={ITEM_STYLE}>
              <div style={META_ROW_STYLE}>
                <span style={BADGE_STYLE}>{kindLabel(item)}</span>
                <span style={BADGE_STYLE}>
                  {fromIdentity.icon} {fromIdentity.short} → {toIdentity.icon} {toIdentity.short}
                </span>
                <span style={BADGE_STYLE}>{item.record.state}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-muted)' }}>
                  {formatTime(item.timeMs)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.65 }}>
                {summarizeLayerProcessRecord(item)}
              </div>
              {renderDialogueRows(item)}
              {item.record.failureReason ? (
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid color-mix(in srgb, var(--danger) 24%, transparent)',
                    background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
                    color: 'var(--danger)',
                    fontSize: 11,
                    lineHeight: 1.55,
                  }}
                >
                  {item.record.failureReason}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
