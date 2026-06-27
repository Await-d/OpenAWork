import type { CSSProperties } from 'react';
import { CK_BORDER, CK_SURFACE } from '../../shared/content-kit/index.js';
import {
  TEAM_LAYER_LABELS,
  canPreviewTeamLayerPrompt,
  type LayerConversationRow,
} from './layered-conversation-model.js';
import {
  CONVERSATION_META_BADGE_STYLE,
  CONVERSATION_SECTION_HEADER_STYLE,
} from './conversation-shared-styles.js';

const STATE_COLORS: Record<string, string> = {
  idle: 'var(--fg-muted)',
  paused: 'var(--warning)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--fg-muted)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};

const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  paused: '已暂停',
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const LIST_PANEL_STYLE: CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: `1px solid ${CK_BORDER}`,
  background: CK_SURFACE,
  overflow: 'hidden',
};

const LIST_SCROLL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  gap: 8,
  padding: '10px',
};

const ROW_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '0',
};

const META_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 2px',
  flexWrap: 'wrap',
};

function formatThreadTime(row: LayerConversationRow): string {
  if (row.timestampMs <= 0) {
    return '无时间';
  }
  return new Date(row.timestampMs).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatThreadRoute(row: LayerConversationRow): string {
  if (!row.fromRoleLayer) {
    return TEAM_LAYER_LABELS[row.toRoleLayer];
  }
  return `${TEAM_LAYER_LABELS[row.fromRoleLayer]} → ${TEAM_LAYER_LABELS[row.toRoleLayer]}`;
}

export interface CrossLayerThreadListPanelProps {
  expandedSessionId: string | null;
  focusHandoffId?: string | null;
  onPreviewPrompt: (layer: LayerConversationRow['toRoleLayer']) => void;
  onToggle: (sessionId: string) => void;
  rows: LayerConversationRow[];
}

export function CrossLayerThreadListPanel({
  expandedSessionId,
  focusHandoffId = null,
  onPreviewPrompt,
  onToggle,
  rows,
}: CrossLayerThreadListPanelProps) {
  return (
    <div style={LIST_PANEL_STYLE}>
      <div style={{ ...CONVERSATION_SECTION_HEADER_STYLE, borderBottom: `1px solid ${CK_BORDER}` }}>
        <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>线程节点</strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          左侧按发生顺序列出层级节点，方便快速识别当前正在看的这一轮链路。
        </span>
      </div>
      <div style={LIST_SCROLL_STYLE}>
        {rows.map((row, idx) => {
          const color = STATE_COLORS[row.state] ?? 'var(--fg-muted)';
          const expanded = expandedSessionId === row.sessionId;
          const isFocus = Boolean(focusHandoffId && row.id === `handoff-${focusHandoffId}`);
          const isLast = idx === rows.length - 1;
          return (
            <div
              key={row.id}
              style={{
                ...ROW_CARD_STYLE,
                paddingBottom: isLast ? 0 : 2,
              }}
            >
              <div style={META_ROW_STYLE}>
                <span
                  style={{ ...CONVERSATION_META_BADGE_STYLE, color: 'var(--fg-muted)', padding: 0 }}
                >
                  #{idx + 1}
                </span>
                {row.handoffCount > 1 ? (
                  <span
                    style={{
                      ...CONVERSATION_META_BADGE_STYLE,
                      background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                      color: 'var(--warning)',
                    }}
                  >
                    第 {row.handoffCount} 轮复用
                  </span>
                ) : null}
                {expanded ? (
                  <span
                    style={{
                      ...CONVERSATION_META_BADGE_STYLE,
                      background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                      color: 'var(--accent)',
                    }}
                  >
                    当前查看
                  </span>
                ) : null}
                {isFocus && !expanded ? (
                  <span
                    style={{
                      ...CONVERSATION_META_BADGE_STYLE,
                      background: 'color-mix(in srgb, var(--aux) 10%, transparent)',
                      color: 'var(--aux)',
                    }}
                  >
                    焦点链路
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flexShrink: 0,
                  width: 14,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: color,
                    marginTop: 12,
                    boxShadow:
                      row.state === 'running'
                        ? `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)`
                        : 'none',
                  }}
                />
                {!isLast ? (
                  <span
                    style={{
                      flex: 1,
                      width: 2,
                      background: 'color-mix(in srgb, var(--border-default) 50%, transparent)',
                      marginTop: 4,
                    }}
                  />
                ) : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => onToggle(row.sessionId)}
                    aria-pressed={expanded}
                    aria-label={`${formatThreadRoute(row)} 会话详情`}
                    className="team-card-soft"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      display: 'grid',
                      gap: 4,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border:
                        expanded || isFocus
                          ? '1px solid color-mix(in srgb, var(--accent) 45%, transparent)'
                          : `1px solid ${CK_BORDER}`,
                      background: expanded
                        ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))'
                        : 'color-mix(in srgb, var(--bg-overlay) 68%, var(--bg-base))',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--fg-strong)',
                        }}
                        title={
                          row.title.trim() ||
                          (row.displayName ? `${row.title} · ${row.displayName}` : row.title)
                        }
                      >
                        {row.title}
                      </span>
                      <span
                        style={{
                          padding: '1px 8px',
                          borderRadius: 999,
                          background: `color-mix(in srgb, ${color} 16%, transparent)`,
                          color,
                          fontSize: 10,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {STATE_LABELS[row.state]}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        minWidth: 0,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                          border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                          color: 'var(--accent)',
                          fontSize: 9.5,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {formatThreadRoute(row)}
                      </span>
                      {row.displayName ? (
                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: 999,
                            background: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
                            color: 'var(--fg-default)',
                            fontSize: 9.5,
                            fontWeight: 600,
                            flexShrink: 0,
                            maxWidth: 100,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={row.displayName}
                        >
                          {row.displayName}
                        </span>
                      ) : null}
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-muted)' }}>
                        {formatThreadTime(row)}
                      </span>
                    </div>
                    {row.detail ? (
                      <span
                        style={{
                          color: expanded ? 'var(--fg-default)' : 'var(--fg-muted)',
                          fontSize: 10.5,
                          lineHeight: 1.45,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                        title={row.detail}
                      >
                        {row.detail}
                      </span>
                    ) : null}
                  </button>
                  {canPreviewTeamLayerPrompt(row.toRoleLayer) ? (
                    <button
                      type="button"
                      onClick={() => onPreviewPrompt(row.toRoleLayer)}
                      title={`查看 ${TEAM_LAYER_LABELS[row.toRoleLayer]} 层的角色提示词`}
                      aria-label={`查看 ${TEAM_LAYER_LABELS[row.toRoleLayer]} 层的角色提示词`}
                      style={{
                        flexShrink: 0,
                        padding: '0 10px',
                        borderRadius: 10,
                        border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                        background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                        color: 'var(--accent)',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      🧬
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
