/**
 * 对话 finalize 自动贴底验收 harness（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分——「finalize 之后视口是否仍停在最新消息」由真实
 * 排版与真实滚动引擎决定：
 *   - 打开长历史会话：开屏贴底必须在首帧绘制前完成（prePaintDistance），
 *     且打开后的迟到增长仍应被跟随
 *   - 流式期间自动跟随贴底（推理默认展开 → 末条消息远高于视口）
 *   - finalize（流式气泡 → 定稿消息）后视口仍应停在最新消息底部
 *   - finalize 后继续出现的高度变化（meta 行、Markdown 惰性块）也应被跟随
 *
 * 渲染的是真实链路：`ChatMessageGroupList` + `useScrollManager` +
 * `renderChatMessageContentWithOptions` / `renderStreamingChatMessageContentWithOptions`。
 *
 * 运行方式见同目录 `README.md`；断言由 `verify-scroll-finalize.ts` 执行。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ChatMessage,
  ChatMessagePart,
} from '../src/components/conversation-runtime/messages/support.js';
import { groupChatRenderEntries } from '../src/components/conversation-runtime/messages/group-render-entries.js';
import { reconcileSnapshotChatMessages } from '../src/components/conversation-runtime/messages/snapshot-reconciliation.js';
import {
  ChatMessageGroupList,
  type ChatRenderEntry,
} from '../src/components/chat/message/chat-message-group-list.js';
import { LatestAssistantMessageContext } from '../src/components/chat/message/collapsible-assistant-content.js';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from '../src/components/chat/session/ChatPageSections.js';
import { useScrollManager } from '../src/components/conversation-runtime/scroll/use-scroll-manager.js';
import { CHAT_SCROLL_BOTTOM_SPACER_HEIGHT } from '../src/components/conversation-runtime/scroll/scroll-constants.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import '../src/components/chat/message/chat-message.css';

const TICK_MS = 60;
const REASONING_TICKS = 26;
const TEXT_TICKS = 26;
const TOTAL_TICKS = REASONING_TICKS + TEXT_TICKS;

/** 历史轮数：>= 16 轮（32 组）触发消息分组虚拟列表。 */
const LONG_HISTORY_TURNS = 18;
const SHORT_HISTORY_TURNS = 5;

export interface HarnessState {
  streaming: boolean;
  reasoningExpandedByDefault: boolean;
  groupCount: number;
  messagesLength: number;
  streamBufferLength: number;
  following: boolean;
  showScrollToBottom: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceToBottom: number;
  /** 末条消息组底边到滚动区域底边的距离（负值 = 已滚出视口下方）。 */
  lastGroupBottomGap: number | null;
  /**
   * 首帧绘制前（layout effect 阶段）测到的距底距离：打开会话时的开屏贴底
   * 必须在第一帧绘制前完成，否则长历史会话会先画一遍最旧的消息。
   */
  prePaintDistance: number | null;
}

export interface ScrollFinalizeHarnessApi {
  start: () => void;
  finalize: () => void;
  /**
   * 定稿后延迟触发一次「快照恢复」对账（对应 ChatPage 的 800ms
   * `loadCurrentSessionSnapshot` → `reconcileSnapshotChatMessages`）。
   */
  snapshotReload: () => void;
  readState: () => HarnessState;
  setReasoningExpanded: (value: boolean) => void;
  /**
   * 模拟输入区 / 面板高度变化（滚动区可视高度随之变化）。正值 = 输入区变高、
   * 滚动区变矮。
   */
  setComposerHeight: (heightPx: number) => void;
  /**
   * 定稿之后才落地的内容增长（异步渲染的 Markdown / 图片解码 / 工具卡输出）：
   * 既没有流式 buffer 变化、也没有消息数变化，只有内容列尺寸变化能触发跟随。
   */
  lateGrow: () => void;
  /** 当前已流出的正文段落数 / 思考段落数（用于在揭示滞后的时刻定稿）。 */
  progress: () => { reasoningParagraphs: number; answerParagraphs: number };
}

declare global {
  interface Window {
    __scrollFinalizeHarness?: ScrollFinalizeHarnessApi;
  }
}

function modeFromUrl(): 'short' | 'long' {
  const value = new URLSearchParams(window.location.search).get('mode');
  return value === 'long' ? 'long' : 'short';
}

function paragraph(prefix: string, index: number): string {
  return `${prefix} ${index}：这段内容用于把消息高度推到远超视口，从而让「是否贴底」可以被精确测量。`;
}

function buildReasoningText(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => paragraph('思考行', index + 1)).join(
    '\n\n',
  );
}

function buildAnswerText(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => paragraph('正文段落', index + 1)).join(
    '\n\n',
  );
}

function buildHistory(turns: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const base = Date.now() - turns * 60_000;
  for (let turn = 0; turn < turns; turn += 1) {
    // 最后一轮（即当前轮之前的那条助手回复）刻意超长：它是「最新一条已定稿回复」，
    // 定稿瞬间会把「最新」让给新回复，从而命中 CollapsibleAssistantContent 的
    // 60vh 折叠 —— 这正是「最新回复不折叠、旧回复折叠」策略在 finalize 时的真实变化。
    const isPreviousTurn = turn === turns - 1;
    const answerText = buildAnswerText(isPreviousTurn ? 40 : 3);
    messages.push({
      id: `user-${turn}`,
      role: 'user',
      content: `第 ${turn + 1} 个问题：请说明这段历史消息用于撑高滚动区域。`,
      createdAt: base + turn * 60_000,
      status: 'completed',
    });
    messages.push({
      id: `assistant-${turn}`,
      role: 'assistant',
      content: answerText,
      parts: [{ id: `assistant-${turn}:text`, type: 'text', text: answerText }],
      createdAt: base + turn * 60_000 + 5_000,
      durationMs: 3200,
      tokenEstimate: 420,
      status: 'completed',
    });
  }
  return messages;
}

function HarnessApp() {
  const mode = useMemo(modeFromUrl, []);
  const turns = mode === 'long' ? LONG_HISTORY_TURNS : SHORT_HISTORY_TURNS;

  const [history, setHistory] = useState<ChatMessage[]>(() => buildHistory(turns));
  const [streaming, setStreaming] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [answer, setAnswer] = useState('');
  const [composerHeight, setComposerHeight] = useState(64);
  const tickRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const streamingMessageIdRef = useRef(`assistant-live-${Date.now()}`);

  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const contentColumnRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [, setHasPendingFollowContent] = useState(false);

  const { isFollowingRef, handleScroll, forceFollowToLatest, isFollowEngaged } = useScrollManager(
    {
      scrollRegionRef,
      bottomRef,
      pendingScrollFrameRef,
      contentColumnRef,
      editorPaneRef,
      textareaRef,
    },
    { setShowScrollToBottom, setHasPendingFollowContent },
    {
      sessionKey: `harness-${mode}`,
      messagesLength: history.length,
      visibleStreaming: streaming,
      visibleStreamBufferLength: answer.length,
      editorMode: false,
    },
  );

  /**
   * 打开会话的贴底触发：与 ChatPage 的 Effect A 同构（layout effect +
   * `forceFollowToLatest`）。`forceFollowToLatest` 的同步首帧让开屏贴底在本帧
   * 绘制前完成——长历史会话打开时不会先画一遍最旧的消息。
   */
  const initialOpenLandedRef = useRef(false);
  useLayoutEffect(() => {
    if (initialOpenLandedRef.current) return;
    initialOpenLandedRef.current = true;
    return forceFollowToLatest('auto');
  }, [forceFollowToLatest]);

  /**
   * 首帧绘制前的距底距离（layout effect 声明在开屏贴底之后 ⇒ 测到的是贴底后的
   * 状态）。断言它 ≤ 1px 即证明「打开即贴底发生在第一帧绘制前」。
   */
  const prePaintDistanceRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const region = scrollRegionRef.current;
    if (!region) return;
    prePaintDistanceRef.current = region.scrollHeight - region.clientHeight - region.scrollTop;
  }, []);

  const streamingMessage: ChatMessage | null = useMemo(() => {
    if (!streaming) return null;
    const parts: ChatMessagePart[] = [];
    if (reasoning.trim().length > 0) {
      parts.push({
        id: `${streamingMessageIdRef.current}:reasoning`,
        type: 'reasoning',
        text: reasoning,
        startedAt: Date.now() - 20_000,
      });
    }
    if (answer.trim().length > 0) {
      parts.push({
        id: `${streamingMessageIdRef.current}:text`,
        type: 'text',
        text: answer,
      });
    }
    return {
      id: streamingMessageIdRef.current,
      role: 'assistant',
      content: answer,
      parts,
      createdAt: Date.now() - 20_000,
      status: 'streaming',
    };
  }, [answer, reasoning, streaming]);

  const groups = useMemo(() => {
    const entries: ChatRenderEntry[] = history.map((message) => ({
      message,
      renderContent: (current: ChatMessage) => renderChatMessageContentWithOptions(current, {}),
    }));
    if (streamingMessage) {
      entries.push({
        message: streamingMessage,
        renderContent: (current: ChatMessage) =>
          renderStreamingChatMessageContentWithOptions(current, {}),
      });
    }
    return groupChatRenderEntries(entries);
  }, [history, streamingMessage]);

  const latestAssistantMessageId = useMemo(() => {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (message?.role === 'assistant') return message.id;
    }
    return null;
  }, [history]);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stopTimer();
    streamingMessageIdRef.current = `assistant-live-${Date.now()}`;
    tickRef.current = 0;
    setReasoning('');
    setAnswer('');
    setStreaming(true);
    timerRef.current = window.setInterval(() => {
      const tick = tickRef.current;
      tickRef.current += 1;
      if (tick < REASONING_TICKS) {
        setReasoning(buildReasoningText(tick + 1));
        return;
      }
      if (tick < TOTAL_TICKS) {
        setAnswer(buildAnswerText(tick - REASONING_TICKS + 1));
        return;
      }
      stopTimer();
    }, TICK_MS);
  }, [stopTimer]);

  const finalize = useCallback(() => {
    stopTimer();
    const id = streamingMessageIdRef.current;
    const reasoningText = buildReasoningText(REASONING_TICKS);
    const answerText = buildAnswerText(TEXT_TICKS);
    setStreaming(false);
    setReasoning('');
    setAnswer('');
    setHistory((previous) => [
      ...previous,
      {
        id,
        role: 'assistant',
        content: answerText,
        parts: [
          {
            id: `${id}:reasoning`,
            type: 'reasoning',
            text: reasoningText,
            startedAt: Date.now() - 20_000,
            endedAt: Date.now() - 5_000,
          },
          { id: `${id}:text`, type: 'text', text: answerText },
        ],
        reasoningBlocksEndedFlags: [true],
        reasoningBlocksDurationsMs: [15_000],
        createdAt: Date.now() - 20_000,
        durationMs: 20_000,
        tokenEstimate: 1_800,
        status: 'completed',
      },
    ]);
  }, [stopTimer]);

  const readState = useCallback((): HarnessState => {
    const region = scrollRegionRef.current;
    const groupRoots = region?.querySelectorAll<HTMLElement>('[data-chat-group-root="true"]');
    const lastGroup = groupRoots?.[groupRoots.length - 1] ?? null;
    const regionRect = region?.getBoundingClientRect() ?? null;
    return {
      streaming,
      reasoningExpandedByDefault: useDisplayPreferencesStore.getState().reasoningExpandedByDefault,
      groupCount: groupRoots?.length ?? 0,
      messagesLength: history.length,
      streamBufferLength: answer.length,
      following: isFollowingRef.current,
      showScrollToBottom,
      scrollTop: region?.scrollTop ?? 0,
      scrollHeight: region?.scrollHeight ?? 0,
      clientHeight: region?.clientHeight ?? 0,
      distanceToBottom:
        region === null || region === undefined
          ? 0
          : region.scrollHeight - region.clientHeight - region.scrollTop,
      lastGroupBottomGap:
        lastGroup && regionRect
          ? regionRect.bottom - lastGroup.getBoundingClientRect().bottom
          : null,
      prePaintDistance: prePaintDistanceRef.current,
    };
  }, [answer.length, history.length, isFollowingRef, showScrollToBottom, streaming]);

  useEffect(() => {
    window.__scrollFinalizeHarness = {
      start,
      finalize,
      readState,
      snapshotReload: () => {
        setHistory((previous) => {
          const last = previous[previous.length - 1];
          if (!last || last.role !== 'assistant') return previous;
          const serverMessage: ChatMessage = {
            ...last,
            // 服务端持久化版本：与本地 parts 同 id、同顺序（真实网关按轮持久化，
            // 恢复投影会带上 reasoning / text 两个 part）。
            status: 'completed',
            tokenEstimate: (last.tokenEstimate ?? 0) + 12,
          };
          return reconcileSnapshotChatMessages(previous, [...previous.slice(0, -1), serverMessage]);
        });
      },
      progress: () => ({
        reasoningParagraphs: reasoning.length === 0 ? 0 : reasoning.split('\n\n').length,
        answerParagraphs: answer.length === 0 ? 0 : answer.split('\n\n').length,
      }),
      setReasoningExpanded: (value: boolean) => {
        useDisplayPreferencesStore.setState({ reasoningExpandedByDefault: value });
      },
      setComposerHeight: (heightPx: number) => {
        setComposerHeight(heightPx);
      },
      lateGrow: () => {
        setHistory((previous) => {
          const last = previous[previous.length - 1];
          if (!last || last.role !== 'assistant') return previous;
          const extra = Array.from({ length: 3 }, (_, index) =>
            paragraph('迟到的渲染内容', index + 1),
          ).join('\n\n');
          const parts = (last.parts ?? []).map((part) =>
            part.type === 'text' ? { ...part, text: `${part.text}\n\n${extra}` } : part,
          );
          return [
            ...previous.slice(0, -1),
            { ...last, content: `${last.content}\n\n${extra}`, parts },
          ];
        });
      },
    };
  }, [answer, finalize, readState, reasoning, start]);

  useEffect(() => stopTimer, [stopTimer]);

  return (
    <LatestAssistantMessageContext value={latestAssistantMessageId}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
        <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--fg-subtle)' }}>
          mode={mode} · groups={groups.length} · streaming={String(streaming)} · follow=
          {String(isFollowEngaged())}
        </div>
        <div
          ref={scrollRegionRef}
          onScroll={handleScroll}
          data-testid="chat-scroll-region"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowAnchor: 'none',
            overscrollBehavior: 'contain',
            padding: '0.9rem 24px 0.95rem',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            scrollPaddingBottom: CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
          }}
        >
          <div
            ref={contentColumnRef}
            data-testid="chat-content-column"
            style={{
              width: '100%',
              maxWidth: 1024,
              margin: '0 auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '1.5rem',
              minHeight: '100%',
              // 与 ChatConversationView 一致：内容列盒子必须随内容增长，
              // 否则滚动跟随依赖的 ResizeObserver 永不回调。
              flexShrink: 0,
            }}
          >
            <ChatMessageGroupList
              activeModelId="harness-model"
              activeModelLabel="Harness Model"
              activeProviderId="harness-provider"
              bottomRef={bottomRef}
              currentUserDisplayName="验收用户"
              currentUserEmail="harness@example.com"
              groups={groups}
              scrollRegionRef={scrollRegionRef}
            />
          </div>
        </div>
        {/* 模拟输入区 / 面板区：高度变化会改变滚动区可视高度（与 composer 同构）。 */}
        <div
          data-testid="harness-composer"
          style={{
            height: composerHeight,
            flexShrink: 0,
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-overlay)',
          }}
        />
      </div>
    </LatestAssistantMessageContext>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<HarnessApp />);
