import { useEffect, useState, type CSSProperties } from 'react';
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
  boxShadow: 'var(--shadow-sm)',
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
  /**
   * 指定要展开查看的角色实例 —— 卡片墙「完整会话」入口的落点。
   *
   * 每次请求都带一个新的 nonce：只传 sessionId 的话，「收起抽屉后再点同一张卡片」
   * 时 props 没有任何变化，effect 不会触发，用户会觉得按钮点了没反应。
   */
  target?: { sessionId: string; nonce: number } | null;
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
  target,
  reviewData,
}: LayerConversationDrawerProps) {
  const nodes = useLayerStore((s) => s.nodes);
  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // 外部点名了角色实例：展开抽屉并切到该 tab。
  // 注意这个 effect 必须在下面的早退之前声明 —— 目标可能在抽屉还不可见时就被设置，
  // 等 visible 变真时展开态已经就位，不会闪一帧收起态。
  useEffect(() => {
    if (!target) return;
    setCollapsed(false);
    setActiveTab(target.sessionId);
  }, [target]);

  const nodeList = Array.from(nodes.values());

  // 有明确目标时即便 layer store 还没有对应节点也照常渲染 ——
  // 卡片墙的实例数据来自会话恢复接口，可能早于 layer store 落库。
  if (!visible || (nodeList.length === 0 && !target)) return null;

  const selectedSessionId = activeTab ?? nodeList[0]?.sessionId ?? null;
  const selectedNode = selectedSessionId ? (nodes.get(selectedSessionId) ?? null) : null;

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
              const isActive = selectedSessionId === node.sessionId;
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
            {selectedSessionId ? (
              selectedNode?.roleLayer === 'reviewer' && reviewData ? (
                <div style={REVIEW_CONTENT_STYLE}>
                  <ReviewReportView
                    reportMarkdown={reviewData.reportMarkdown}
                    overallVerdict={reviewData.overallVerdict}
                    specReviewPassed={reviewData.specReviewPassed}
                    qualityReviewPassed={reviewData.qualityReviewPassed}
                  />
                </div>
              ) : selectedNode?.roleLayer === 'reviewer' ? (
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
                // 没有 layer 节点时也渲染完整会话：卡片墙的实例来自会话恢复接口，
                // 可能早于 layer store 落库，不该因此变成「点了没反应」。
                <TeamConversationView
                  key={selectedSessionId}
                  sessionId={selectedSessionId}
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
