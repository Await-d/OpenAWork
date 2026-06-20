import type { CSSProperties } from 'react';
import { EmptyState } from '../../shared/content-kit/index.js';
import { CONVERSATION_SECTION_HEADER_STYLE } from './conversation-shared-styles.js';

const BODY_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

export function LayerFlowDetailEmptyState() {
  return (
    <>
      <div style={CONVERSATION_SECTION_HEADER_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>右侧详情</strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          选中上方节点或左侧记录后，这里会显示摘要、产物和对应层级内容。
        </span>
      </div>
      <div style={BODY_STYLE}>
        <EmptyState
          emoji="💬"
          title="选择上方节点或左侧消息查看详情"
          description="点击流水线上的层级节点展开该层对话；点击左侧分组记录查看一次具体的层间传递。"
          style={{ flex: 1 }}
        />
      </div>
    </>
  );
}
