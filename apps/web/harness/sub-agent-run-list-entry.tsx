/**
 * `SubAgentRunList`（主对话区左栏子代理运行列表）折叠验收 harness。
 *
 * 覆盖 jsdom 覆盖不到的部分：
 *   - 真实布局：折叠后 section 高度收缩为表头高度、卡片列表 `display:none`、
 *     展开后高度恢复到宿主高度（`bottom: 0` 生效）
 *   - hover 背景解析到真实存在的 `--bg-hover` 哨兵（变量名笔误在 jsdom 中不可见）
 *   - focus ring 的计算值（outline 2px accent + 4px accent-subtle 阴影）
 *   - 375 / 768 / 1280 三视口下固定 200px 栏宽不溢出宿主
 *   - 折叠前后表头计数 / 活跃徽标始终可见；点击卡片与停止按钮回调接线
 *
 * 运行方式见同目录 `README.md`。断言由 `verify-sub-agent-run-list.ts` 执行。
 */
import { createRoot } from 'react-dom/client';
import {
  SubAgentRunList,
  type SubAgentRunItem,
} from '../src/pages/chat-page/panels/sub-agent-run-list.js';

declare global {
  interface Window {
    /** 卡片 / 停止按钮回调记录（供断言点击接线）。 */
    __subAgentRunListHarness?: { calls: string[] };
  }
}
window.__subAgentRunListHarness = { calls: [] };

const ITEMS: SubAgentRunItem[] = [
  {
    sessionId: 'child-harness-running',
    shortSessionId: 'child-ha',
    status: 'running',
    taskLabel: '审计会话唤醒原语',
    title: '审计会话唤醒原语并整理结论',
    assignedAgent: 'explore',
    messageCount: 12,
  },
  {
    sessionId: 'child-harness-paused',
    shortSessionId: 'child-hb',
    status: 'paused',
    taskLabel: '等待确认的子任务',
    title: '等待确认的子任务',
    assignedAgent: 'general',
    messageCount: 3,
  },
  {
    sessionId: 'child-harness-completed',
    shortSessionId: 'child-hc',
    status: 'completed',
    taskLabel: '已完成的子任务',
    title: '已完成的子任务',
    result: '已完成第一轮排查，结论已写入子会话。',
    messageCount: 28,
  },
];

function Viewport(props: { label: string; width: number }) {
  return (
    <div className="viewport" data-viewport={props.width}>
      <div className="viewport-label">{props.label}</div>
      <div className="harness-theme host" style={{ width: props.width }}>
        <SubAgentRunList
          items={ITEMS}
          selectedSessionId={null}
          onSelectSession={(sessionId) =>
            window.__subAgentRunListHarness?.calls.push(`open:${sessionId}`)
          }
          onStopSession={(sessionId) =>
            window.__subAgentRunListHarness?.calls.push(`stop:${sessionId}`)
          }
        />
        <div className="fake-message-stream" aria-hidden="true">
          <div className="fake-message">消息流占位：子代理列表折叠后不遮挡这里</div>
          <div className="fake-message">第二条消息占位</div>
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
