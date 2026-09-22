/**
 * 子代理通知行三视口验收 harness。
 *
 * 用**真实浏览器**渲染真实的 `SubagentNoticeRow`，覆盖 jsdom 覆盖不到的部分：
 *   - 真实布局下的省略号截断（含两条**真实祖先链路**，见下方注释）
 *   - 真实引擎解析 CSS 变量后的三态语义色
 *   - focus ring 的计算样式
 *   - `failed` 空描述强制可见
 *   - 点击回传子会话 id
 *
 * 运行方式见同目录 `README.md`。视觉产物由 `verify-notice-3viewports.ts` 断言。
 */
import { createRoot } from 'react-dom/client';
import type { SubagentNotice } from '@openAwork/shared';
import { SubagentNoticeRow } from '@openAwork/shared-ui';
import '../src/components/chat/message/chat-message.css';

const LONG_DESCRIPTION =
  '审计会话唤醒原语并逐条核对上游语义：这是刻意写得很长的任务标签，用于在窄视口下验证省略号截断是否真正生效，而不是把行撑开或换行。';

function notice(overrides: Partial<SubagentNotice>): SubagentNotice {
  return {
    id: 'notice-harness-1',
    agent: 'explore',
    state: 'done',
    description: LONG_DESCRIPTION,
    childSessionId: 'child-harness-1',
    text: '子代理已完成 · 审计会话唤醒原语',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

declare global {
  interface Window {
    __noticeHarnessClicks?: string[];
  }
}
window.__noticeHarnessClicks = [];

function Viewport(props: { label: string; width: number }) {
  return (
    <div className="viewport" style={{ width: props.width }}>
      <div className="viewport-label">{props.label}</div>
      <div data-case="done-long">
        <SubagentNoticeRow
          notice={notice({ state: 'done' })}
          onOpenChild={(id) => window.__noticeHarnessClicks?.push(`done:${id}`)}
        />
      </div>
      <div data-case="failed-long">
        <SubagentNoticeRow
          notice={notice({ id: 'n-failed', state: 'failed', agent: 'general' })}
          onOpenChild={(id) => window.__noticeHarnessClicks?.push(`failed:${id}`)}
        />
      </div>
      <div data-case="cancelled-long">
        <SubagentNoticeRow notice={notice({ id: 'n-cancelled', state: 'cancelled' })} />
      </div>
      <div data-case="failed-empty-desc">
        <SubagentNoticeRow
          notice={notice({ id: 'n-failed-empty', state: 'failed', description: '' })}
        />
      </div>
      <div data-case="grouped">
        <SubagentNoticeRow notice={notice({ id: 'n-grouped', description: '短标签' })} grouped />
      </div>
      {/*
        主题链：外层 `.themed` 提供哨兵色值的 CSS 变量（见 html 注释）。
        组件 token 是 `var(--x, fallback)` 形式 —— 本链证明「有变量时跟随主题」，
        与默认的兜底链互补；两条链的期望值在断言脚本里分别推导。
      */}
      <div className="themed">
        <div data-case="themed-done">
          <SubagentNoticeRow notice={notice({ id: 'n-themed-done', state: 'done' })} />
        </div>
        <div data-case="themed-failed">
          <SubagentNoticeRow
            notice={notice({ id: 'n-themed-failed', state: 'failed', description: '' })}
          />
        </div>
        <div data-case="themed-cancelled">
          <SubagentNoticeRow notice={notice({ id: 'n-themed-cancelled', state: 'cancelled' })} />
        </div>
      </div>
      {/*
        真实链路 A —— chat 端虚拟化列表：群组被包在 `position:absolute; left:0; right:0`
        的定位层里（绝对定位元素不是 flex 项，宽度由 left/right 决定）。
        见 components/chat/message/virtualized-chat-group-list.tsx。
      */}
      <div style={{ position: 'relative', minHeight: 120 }}>
        <div
          data-case="chat-chain"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, overflow: 'visible' }}
        >
          <div className="chat-message-group" data-chat-group-root="true" data-role="assistant">
            <SubagentNoticeRow
              notice={notice({ id: 'n-chat-chain', description: LONG_DESCRIPTION })}
              onOpenChild={(id) => window.__noticeHarnessClicks?.push(`chat:${id}`)}
            />
          </div>
        </div>
      </div>
      {/*
        真实链路 B —— team 端非虚拟化：SPLIT_INNER_STYLE → CONVERSATION_STREAM_STYLE
        （显式 minWidth:0）→ scrollRegionStyle → contentColumnStyle，**全为 column flex**。
        见 pages/team/conversation/TeamConversationLayout.tsx。

        ⚠️ 这条链路曾是真实风险点：若祖先里出现 row 方向 flex 且缺 `min-width: 0`，
        通知行的 `white-space: nowrap` 会让 min-content = 整行文本宽度，把容器撑到视口之外，
        省略号随之失效。当前两端都是 column flex（或绝对定位），故不会发生——本用例就是守卫它。
      */}
      <div
        data-case="team-chain"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            width: '100%',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              width: '100%',
            }}
          >
            <div className="chat-message-group" data-chat-group-root="true" data-role="assistant">
              <SubagentNoticeRow
                notice={notice({ id: 'n-team-chain', description: LONG_DESCRIPTION })}
                onOpenChild={(id) => window.__noticeHarnessClicks?.push(`team:${id}`)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <Viewport label="375px" width={375} />
    <Viewport label="768px" width={768} />
    <Viewport label="1280px" width={1280} />
  </>,
);
