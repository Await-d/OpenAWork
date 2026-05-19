/**
 * 260515-team-phase-b · T-15（v1.4 升级）
 *
 * 底部抽屉层级对话查看器。
 *
 * v1.4 升级要点：
 *   - 选中非 reviewer 层级时，内容区直接 `<TeamConversationView/>` 渲染对应 session
 *     的 chat 消息流，与 LayeredConversationView tab 双栏右侧保持一致
 *   - reviewer 层仍走 `<ReviewReportView/>`（review 视图独立 layout）
 *   - 收起时只露 36px 标题条，展开后内容区给 chat 渲染留出至少 320px 高度
 *
 * 设计：
 *   - 底部固定抽屉（可折叠），LayerTabBar 切换不同层级的 session
 *   - 单层级多个 session 时按时间倒序展示首个进入抽屉
 *
 * Phase B MVP 已升级到与 chat 渲染对齐；进一步丰富的 actions / 滚动恢复等
 * 由 SessionConversationView 内部统一负责。
 */

import { useState, type CSSProperties } from 'react';
import { useLayerStore, type TeamRoleLayer } from '../../../../../stores/team/team-events.js';
import { ReviewReportView } from '../../tabs/tasks/ReviewReportView.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';

const DRAWER_STYLE: CSSProperties = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  borderTop: '1px solid color-mix(in srgb, var(--border-default) 82%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 96%, var(--bg-base))',
  boxShadow: '0 -4px 24px rgba(0,0,0,0.08)',
  transition: 'transform 200ms ease',
};

const DRAWER_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 16px',
  cursor: 'pointer',
  userSelect: 'none',
};

const CLOSE_BUTTON_STYLE: CSSProperties = {
  marginLeft: 'auto',
  width: 24,
  height: 24,
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
  color: 'var(--fg-muted)',
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
};

const TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '4px 16px',
  overflowX: 'auto',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
};

const TAB_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const CONTENT_STYLE: CSSProperties = {
  padding: 0,
  height: 'min(420px, 60vh)',
  minHeight: 320,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  fontSize: 12,
  color: 'var(--fg-default)',
};

const REVIEW_CONTENT_STYLE: CSSProperties = {
  padding: 16,
  maxHeight: 280,
  overflowY: 'auto',
  fontSize: 12,
  color: 'var(--fg-default)',
};

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  reviewer: '评审',
};

export interface LayerConversationDrawerProps {
  visible?: boolean;
  onClose?: () => void;
  reviewData?: {
    reportMarkdown: string | null;
    overallVerdict: 'pass' | 'implementation-failure' | 'planning-failure' | null;
    specReviewPassed: boolean | null;
    qualityReviewPassed: boolean | null;
  } | null;
}

export function LayerConversationDrawer({
  visible = false,
  onClose,
  reviewData,
}: LayerConversationDrawerProps) {
  const nodes = useLayerStore((s) => s.nodes);
  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const nodeList = Array.from(nodes.values());

  if (!visible || nodeList.length === 0) return null;

  const selectedNode = activeTab ? nodes.get(activeTab) : nodeList[0];

  return (
    <div
      style={{
        ...DRAWER_STYLE,
        transform: collapsed ? 'translateY(calc(100% - 36px))' : 'translateY(0)',
      }}
    >
      <div
        style={DRAWER_HEADER_STYLE}
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label="层级对话查看器"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setCollapsed((v) => !v);
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 800 }}>{collapsed ? '▲' : '▼'} 层级对话</span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{nodeList.length} 个 session</span>
        {onClose ? (
          <button
            type="button"
            style={CLOSE_BUTTON_STYLE}
            aria-label="关闭层级对话抽屉"
            title="关闭层级对话抽屉"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            ×
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <>
          <div style={TAB_BAR_STYLE}>
            {nodeList.map((node) => {
              const isActive = (activeTab ?? nodeList[0]?.sessionId) === node.sessionId;
              return (
                <button
                  key={node.sessionId}
                  type="button"
                  style={{
                    ...TAB_STYLE,
                    background: isActive
                      ? 'color-mix(in srgb, var(--accent) 14%, var(--bg-overlay))'
                      : 'transparent',
                    borderColor: isActive
                      ? 'color-mix(in srgb, var(--accent) 40%, transparent)'
                      : 'transparent',
                    color: isActive ? 'var(--fg-strong)' : 'var(--fg-muted)',
                  }}
                  onClick={() => setActiveTab(node.sessionId)}
                >
                  {LAYER_LABELS[node.roleLayer]} · {node.state}
                </button>
              );
            })}
          </div>
          <div style={CONTENT_STYLE}>
            {selectedNode ? (
              selectedNode.roleLayer === 'reviewer' && reviewData ? (
                <div style={REVIEW_CONTENT_STYLE}>
                  <ReviewReportView
                    reportMarkdown={reviewData.reportMarkdown}
                    overallVerdict={reviewData.overallVerdict}
                    specReviewPassed={reviewData.specReviewPassed}
                    qualityReviewPassed={reviewData.qualityReviewPassed}
                  />
                </div>
              ) : selectedNode.roleLayer === 'reviewer' ? (
                <div
                  style={{
                    ...REVIEW_CONTENT_STYLE,
                    fontStyle: 'italic',
                    color: 'var(--fg-muted)',
                  }}
                >
                  等待审查结果...
                </div>
              ) : (
                <TeamConversationView sessionId={selectedNode.sessionId} compact />
              )
            ) : (
              <div
                style={{
                  ...REVIEW_CONTENT_STYLE,
                  color: 'var(--fg-muted)',
                }}
              >
                选择一个 tab 查看详情
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
