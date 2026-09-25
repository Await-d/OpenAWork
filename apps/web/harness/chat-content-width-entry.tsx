/**
 * 对话内容列「随可用宽度自适应」验收 harness（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分：`clamp(px, %, px)` 在真实引擎里的解析、
 * 以及内容列在真实 flex / 滚动链里的**实际渲染宽度与居中边距**。
 *
 * 渲染口径与 `ChatConversationView` 一致（同一套内联样式形状）：
 * 滚动区（padding + flex column）→ 内容列（width:100% + maxWidth clamp + margin:0 auto），
 * `maxWidth` 直接调用真实的 `resolveResponsiveContentMaxWidth`（策略本体）。
 * 组件接线（哪个模式用哪个基准）由 `ChatConversationView.test.tsx` 守卫。
 *
 * 运行方式见同目录 `README.md`；断言由 `verify-chat-content-width.ts` 执行。
 */
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveResponsiveContentMaxWidth } from '../src/pages/chat-page/layout/conversation-layout-state.js';
import { CONTENT_WIDTH_PANES } from './chat-content-width-fixtures.js';

/** 与 ChatConversationView 相同的滚动区 padding 形状（百分比基准 = 其内容盒）。 */
const SCROLL_REGION_STYLE: CSSProperties = {
  overflowY: 'auto',
  overflowAnchor: 'none',
  overscrollBehavior: 'contain',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  padding: '0.9rem clamp(10px, 3vw, 32px)',
};

const CONTENT_COLUMN_STYLE: CSSProperties = {
  width: '100%',
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  minHeight: 96,
};

function PaneCase({ id, label, paneWidthPx, baselinePx }: (typeof CONTENT_WIDTH_PANES)[number]) {
  return (
    <section className="pane-row" data-pane={id}>
      <div className="pane-label">{label}</div>
      <div
        className="pane"
        data-testid={`pane-${id}`}
        data-baseline-px={baselinePx}
        style={{ width: paneWidthPx }}
      >
        <div className="scroll-region" data-testid={`scroll-${id}`} style={SCROLL_REGION_STYLE}>
          <div
            data-testid={`column-${id}`}
            style={{
              ...CONTENT_COLUMN_STYLE,
              maxWidth: resolveResponsiveContentMaxWidth(baselinePx),
            }}
          >
            <div className="column-fill">内容列 · 基准 {baselinePx}px</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HarnessApp() {
  return (
    <div>
      {CONTENT_WIDTH_PANES.map((pane) => (
        <PaneCase key={pane.id} {...pane} />
      ))}
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('harness 缺少 #root 挂载点');
}
createRoot(rootElement).render(<HarnessApp />);
