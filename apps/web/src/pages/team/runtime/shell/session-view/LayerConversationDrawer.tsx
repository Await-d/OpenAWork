import { useState, type CSSProperties } from 'react';
import {
  useLayerStore,
  type LayerNode,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { ReviewReportView, type ReviewVerdict } from '../../tabs/tasks/ReviewReportView.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';

const DRAWER_STYLE: CSSProperties = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  borderTop: '1px solid color-mix(in srgb, var(--border-default) 82%, transparent)',
  background: 'var(--bg-overlay)',
  boxShadow: '0 -2px 12px rgba(0,0,0,0.1)',
  transition: 'transform 200ms ease',
};

const DRAWER_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '6px 12px',
  height: 36,
  userSelect: 'none',
};

const CLOSE_BUTTON_STYLE: CSSProperties = {
  marginLeft: 'auto',
  width: 24,
  height: 24,
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: '4px 12px',
  overflowX: 'auto',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
};

const TAB_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 4,
  border: 'none',
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
  padding: 12,
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
  tester: '测试',
  reviewer: '评审',
};

function getLayerNodeLabel(node: LayerNode): string {
  const displayName = node.displayName?.trim();
  return displayName && displayName.length > 0 ? displayName : LAYER_LABELS[node.roleLayer];
}

export interface LayerConversationDrawerProps {
  visible?: boolean;
  onClose?: () => void;
  reviewData?: {
    reportMarkdown: string | null;
    overallVerdict: ReviewVerdict;
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
      <div style={DRAWER_HEADER_STYLE}>
        <span
          style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer', flex: 1 }}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? '▲' : '▼'} 层级对话
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{nodeList.length}</span>
        <button
          type="button"
          style={CLOSE_BUTTON_STYLE}
          aria-label="关闭"
          title="关闭"
          onClick={() => onClose?.()}
        >
          ×
        </button>
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
                      ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                      : 'transparent',
                    color: isActive ? 'var(--fg-strong)' : 'var(--fg-muted)',
                  }}
                  onClick={() => setActiveTab(node.sessionId)}
                >
                  {getLayerNodeLabel(node)} · {node.state}
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
                <TeamConversationView
                  key={selectedNode.sessionId}
                  sessionId={selectedNode.sessionId}
                  compact
                />
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
