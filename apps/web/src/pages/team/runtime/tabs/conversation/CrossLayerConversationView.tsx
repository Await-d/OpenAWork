/**
 * 260530-team-page · Wave 3 · CrossLayerConversationView（F3 跨层对话线程）
 *
 * 与 LayeredConversationView（双栏 timeline + 右侧单会话）不同，这里把一次任务链
 * 的层间 handoff **纵向串联成一条对话线程**：
 *
 *   接待 ─▶ PM1 ─▶ PM2 ─▶ 执行 ─▶ 评审
 *     每个节点展示：from→to、状态、时间、请求载荷摘要
 *     点击节点 → 内联展开该层 session 的完整 TeamConversationView
 *
 * 数据来源：useHandoffStore（层间 handoff 边）。无新后端依赖。
 */

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import {
  useHandoffStore,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState, CK_BORDER, CK_SURFACE } from '../../shared/content-kit/index.js';
import { RolePromptPreviewPanel } from '../../shared/RolePromptPreviewPanel.js';

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1 · 规划',
  pm2: 'PM2 · 管控',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

const LAYER_ORDER: Record<TeamRoleLayer, number> = {
  user: 0,
  reception: 1,
  pm1: 2,
  pm2: 3,
  executor: 4,
  tester: 5,
  reviewer: 6,
};

const STATE_COLORS: Record<string, string> = {
  idle: 'var(--fg-muted)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--fg-muted)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};

const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

export interface CrossLayerConversationViewProps {
  /** 可选：聚焦某条 handoff（默认展开它）。 */
  focusHandoffId?: string | null;
}

export function CrossLayerConversationView({ focusHandoffId }: CrossLayerConversationViewProps) {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [promptPreviewLayer, setPromptPreviewLayer] = useState<TeamRoleLayer | null>(null);

  // 按层级顺序 + 时间排序，形成一条自上而下的链路线程。
  const thread = useMemo(() => {
    const list = Array.from(handoffs.values());
    list.sort((a, b) => {
      const layerDelta = (LAYER_ORDER[a.toRoleLayer] ?? 99) - (LAYER_ORDER[b.toRoleLayer] ?? 99);
      if (layerDelta !== 0) return layerDelta;
      return (a.startedAt ?? a.updatedAt) - (b.startedAt ?? b.updatedAt);
    });
    return list;
  }, [handoffs]);

  const handleToggle = useCallback((sessionId: string | undefined) => {
    if (!sessionId) return;
    setExpandedSessionId((prev) => (prev === sessionId ? null : sessionId));
  }, []);

  if (thread.length === 0) {
    return (
      <TabContainer
        title="跨层对话线程"
        subtitle="把一次任务链的层间 handoff 串成一条线程，逐层展开会话内容。"
      >
        <EmptyState
          emoji="🧵"
          title="暂无跨层对话"
          description="团队启动后，reception → pm1 → pm2 → executor → reviewer 的 handoff 会在这里串成线程。"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="跨层对话线程"
      subtitle="把一次任务链的层间 handoff 串成一条线程，逐层展开会话内容。"
    >
      <div style={CONTAINER_STYLE}>
        {thread.map((entry, idx) => {
          const color = STATE_COLORS[entry.state] ?? 'var(--fg-muted)';
          const expanded = Boolean(entry.sessionId && expandedSessionId === entry.sessionId);
          const isFocus = Boolean(focusHandoffId && entry.id === focusHandoffId);
          const clickable = Boolean(entry.sessionId);
          const isLast = idx === thread.length - 1;
          return (
            <div key={entry.id} style={{ display: 'flex', gap: 10 }}>
              {/* 左侧时间轴：圆点 + 连接线 */}
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
                      entry.state === 'running'
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

              {/* 右侧节点卡片 */}
              <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 8 }}>
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => handleToggle(entry.sessionId)}
                    disabled={!clickable}
                    aria-expanded={expanded}
                    className="team-card-soft"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: isFocus
                        ? '1px solid color-mix(in srgb, var(--accent) 55%, transparent)'
                        : `1px solid ${CK_BORDER}`,
                      background: expanded
                        ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))'
                        : CK_SURFACE,
                      cursor: clickable ? 'pointer' : 'default',
                      opacity: clickable ? 1 : 0.6,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)' }}>
                      {LAYER_LABELS[entry.fromRoleLayer]} → {LAYER_LABELS[entry.toRoleLayer]}
                    </span>
                    <span
                      style={{
                        padding: '1px 8px',
                        borderRadius: 999,
                        background: `color-mix(in srgb, ${color} 16%, transparent)`,
                        color,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {STATE_LABELS[entry.state] ?? entry.state}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                      {new Date(entry.updatedAt).toLocaleTimeString()}
                    </span>
                    {clickable ? (
                      <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                        {expanded ? '收起 ▲' : '展开 ▼'}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptPreviewLayer(entry.toRoleLayer)}
                    title={`查看 ${LAYER_LABELS[entry.toRoleLayer]} 层的角色提示词`}
                    aria-label={`查看 ${LAYER_LABELS[entry.toRoleLayer]} 层的角色提示词`}
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
                </div>

                {entry.summary ? (
                  <div
                    style={{
                      marginTop: 4,
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
                      fontSize: 11,
                      color: 'var(--fg-muted)',
                      lineHeight: 1.5,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                    title={entry.summary}
                  >
                    {entry.summary}
                  </div>
                ) : null}

                {expanded && entry.sessionId ? (
                  <div
                    style={{
                      marginTop: 6,
                      height: 'min(420px, 50vh)',
                      borderRadius: 10,
                      border: `1px solid ${CK_BORDER}`,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <TeamConversationView sessionId={entry.sessionId} compact />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <RolePromptPreviewPanel
        layer={promptPreviewLayer}
        onClose={() => setPromptPreviewLayer(null)}
      />
    </TabContainer>
  );
}
