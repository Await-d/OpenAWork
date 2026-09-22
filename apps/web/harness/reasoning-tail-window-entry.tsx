/**
 * 思考块「贴底折叠窗口」验收 harness（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分——jsdom 没有布局引擎，折叠之后**看到哪几行**只有真实
 * 引擎能判定：
 *   - 折叠态可见区落在**末尾**（开头被裁到容器上方，而不是显示开头、末尾被裁）
 *   - 流式追加内容后，新末行自动进入可见区（无 JS 跟随滚动、无滚动位置跳变）
 *   - 「展开 / 收起」交互后可见区回到末尾
 *   - 流式与静态折叠的可见区完全一致（finalize 不翻转方向）
 *
 * 渲染的是真实链路：`renderStreamingChatMessageContentWithOptions` /
 * `renderChatMessageContentWithOptions` → 真实 Markdown 正文 + 真实折叠按钮。
 *
 * 运行方式见同目录 `README.md`。断言由 `verify-reasoning-tail-window.ts` 执行。
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatMessage } from '../src/components/conversation-runtime/messages/support.js';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from '../src/components/chat/session/ChatPageSections.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import '../src/components/chat/message/chat-message.css';

const INITIAL_LINE_COUNT = 24;
/** 长思考：确保超过消息级折叠阈值（1500 字符），用于守卫"思考块内不再叠加折叠"。 */
const LONG_LINE_COUNT = 60;
const VIEWPORTS = [375, 768, 1280];

function lineText(lineNumber: number): string {
  return `思考行 ${lineNumber}：这段推理内容用于验证折叠窗口的可见区落在末尾而不是开头。`;
}

function buildReasoningText(lineCount: number): string {
  // 用空行分段：折叠窗口是按像素钳制，段落块让"最后一行是否可见"可以被精确测量。
  return Array.from({ length: lineCount }, (_, index) => lineText(index + 1)).join('\n\n');
}

/** 长思考里再塞一个超过 100 行的代码块：守卫"思考块内不再有代码块自己的折叠"。 */
function buildLongReasoningText(): string {
  const fence = [
    '```ts',
    ...Array.from({ length: 150 }, (_, index) => `const value${index} = ${index};`),
    '```',
  ].join('\n');
  return `${buildReasoningText(LONG_LINE_COUNT)}\n\n${fence}`;
}

/** 长正文 + ```thinking 围栏：守卫"消息级折叠生效时，思考围栏块不再自折叠"。 */
function buildLongMessageWithThinkingFence(): string {
  const filler = Array.from(
    { length: 60 },
    (_, index) => `正文段落 ${index + 1}：用于把正文推过 1500 字符阈值，触发消息级折叠。`,
  ).join('\n\n');
  const fence = [
    '```thinking',
    ...Array.from({ length: 8 }, (_, index) => `思考第 ${index + 1} 行内容`),
    '```',
  ].join('\n');
  return `${filler}\n\n${fence}`;
}

/** 供验收脚本驱动"流式继续输出"：所有视口内的实时用例一起增长。 */
let totalLines = INITIAL_LINE_COUNT;
const appendListeners = new Set<() => void>();

declare global {
  interface Window {
    __reasoningHarnessAppendLines?: (count?: number) => number;
    __reasoningHarnessLineCount?: number;
  }
}

window.__reasoningHarnessAppendLines = (count = 1) => {
  totalLines += count;
  window.__reasoningHarnessLineCount = totalLines;
  for (const listener of appendListeners) {
    listener();
  }
  return totalLines;
};
window.__reasoningHarnessLineCount = totalLines;

// 与默认值一致，但仍显式固定：验收脚本依赖"折叠 + 显示推理块"这一前提。
useDisplayPreferencesStore.setState({
  showReasoningBlock: true,
  reasoningExpandedByDefault: false,
});

function useHarnessLineCount(): number {
  const [lineCount, setLineCount] = useState(totalLines);
  useEffect(() => {
    const listener = () => setLineCount(totalLines);
    appendListeners.add(listener);
    return () => {
      appendListeners.delete(listener);
    };
  }, []);
  return lineCount;
}

function LiveReasoningCase() {
  const lineCount = useHarnessLineCount();
  const message: ChatMessage = {
    id: 'harness-reasoning-live',
    role: 'assistant',
    content: '',
    parts: [{ id: 'reasoning-live-1', type: 'reasoning', text: buildReasoningText(lineCount) }],
    reasoningBlocksEndedFlags: [false],
  };
  return <>{renderStreamingChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>;
}

function StaticReasoningCase() {
  const message: ChatMessage = {
    id: 'harness-reasoning-static',
    role: 'assistant',
    content: '',
    parts: [
      {
        id: 'reasoning-static-1',
        type: 'reasoning',
        text: buildReasoningText(INITIAL_LINE_COUNT),
      },
    ],
    reasoningBlocksEndedFlags: [true],
    reasoningBlocksDurationsMs: [2345],
  };
  return <>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>;
}

/**
 * 长思考（>1500 字符）历史消息：用于守卫"思考块内不得再出现消息级折叠"。
 * 思考块自带 展开/收起，若内部再套一层「展开全部 · N 字符」，同一内容就有两层折叠提示。
 */
function LongStaticReasoningCase() {
  const message: ChatMessage = {
    id: 'harness-reasoning-static-long',
    role: 'assistant',
    content: '',
    parts: [
      {
        id: 'reasoning-static-long-1',
        type: 'reasoning',
        text: buildLongReasoningText(),
      },
    ],
    reasoningBlocksEndedFlags: [true],
    reasoningBlocksDurationsMs: [4321],
  };
  return <>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>;
}

/**
 * 长正文 + ```thinking 围栏：思考围栏块自带「展开思考」，若消息级折叠再叠一层，
 * 同一屏就出现两级展开提示。折叠归属外层（消息级），内层不再提示。
 */
function LongMessageThinkingFenceCase() {
  const message: ChatMessage = {
    id: 'harness-long-message-thinking-fence',
    role: 'assistant',
    content: buildLongMessageWithThinkingFence(),
  };
  return <>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>;
}

function Viewport({ width }: { width: number }) {
  return (
    <div className="viewport" data-viewport={width} style={{ width }}>
      <div className="viewport-label">{width}px</div>
      <div className="case" data-case="live-streaming">
        <div className="case-label">流式进行中（折叠）</div>
        <LiveReasoningCase />
      </div>
      <div className="case" data-case="static-finalized">
        <div className="case-label">已完成（折叠）</div>
        <StaticReasoningCase />
      </div>
      <div className="case" data-case="static-long-reasoning">
        <div className="case-label">已完成长思考（历史消息，&gt;1500 字符 + 长代码块）</div>
        <LongStaticReasoningCase />
      </div>
      <div className="case" data-case="long-message-thinking-fence">
        <div className="case-label">长正文 + ```thinking 围栏（历史消息）</div>
        <LongMessageThinkingFenceCase />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    {VIEWPORTS.map((width) => (
      <Viewport key={width} width={width} />
    ))}
  </>,
);
