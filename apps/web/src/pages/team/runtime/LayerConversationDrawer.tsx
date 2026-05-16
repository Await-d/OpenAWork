/**
 * 260515-team-phase-b · T-15
 *
 * 底部抽屉层级对话查看器。
 *
 * 设计：
 *   - 底部固定抽屉（可折叠），展示当前选中 session 的对话内容
 *   - LayerTabBar 切换不同层级的 session
 *   - 每个 tab 内嵌一个只读对话流（复用现有 chat message 渲染）
 *
 * Phase B MVP：只展示 session 列表 + 基本信息，不做完整对话流渲染
 * （完整渲染需要 message-v2 adapter 接入，留到 Phase C）。
 */

import { useState, type CSSProperties } from 'react';
import { useLayerStore, type TeamRoleLayer } from '../../../stores/team-events.js';
import { ReviewReportView } from './ReviewReportView.js';

const DRAWER_STYLE: CSSProperties = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  borderTop: '1px solid color-mix(in srgb, var(--border) 82%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 96%, var(--bg))',
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
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
  color: 'var(--text-3)',
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
};

const TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '4px 16px',
  overflowX: 'auto',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
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
  padding: 16,
  maxHeight: 280,
  overflowY: 'auto',
  fontSize: 12,
  color: 'var(--text-2)',
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
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{nodeList.length} 个 session</span>
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
                      ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
                      : 'transparent',
                    borderColor: isActive
                      ? 'color-mix(in srgb, var(--accent) 40%, transparent)'
                      : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--text-3)',
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
              <div style={{ display: 'grid', gap: 8 }}>
                {selectedNode.roleLayer === 'reviewer' && reviewData ? (
                  <ReviewReportView
                    reportMarkdown={reviewData.reportMarkdown}
                    overallVerdict={reviewData.overallVerdict}
                    specReviewPassed={reviewData.specReviewPassed}
                    qualityReviewPassed={reviewData.qualityReviewPassed}
                  />
                ) : selectedNode.roleLayer === 'reviewer' ? (
                  <div
                    style={{
                      padding: 12,
                      fontSize: 12,
                      color: 'var(--text-3)',
                      fontStyle: 'italic',
                    }}
                  >
                    等待审查结果...
                  </div>
                ) : (
                  <>
                    <div>
                      <strong>Session：</strong>
                      <code style={{ fontSize: 11 }}>{selectedNode.sessionId}</code>
                    </div>
                    <div>
                      <strong>层级：</strong> {LAYER_LABELS[selectedNode.roleLayer]}
                    </div>
                    <div>
                      <strong>状态：</strong> {selectedNode.state}
                    </div>
                    {selectedNode.parentSessionId ? (
                      <div>
                        <strong>父 Session：</strong>
                        <code style={{ fontSize: 11 }}>{selectedNode.parentSessionId}</code>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <span style={{ color: 'var(--text-3)' }}>选择一个 tab 查看详情</span>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
