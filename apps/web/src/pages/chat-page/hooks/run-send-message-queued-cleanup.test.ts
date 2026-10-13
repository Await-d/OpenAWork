// @vitest-environment jsdom
/**
 * 回归：待发队列条目在**每一条「消费成功」出口**都要清掉服务端记录。
 *
 * 背景：队列改为后端落库后，删记录不再由 persist effect 自动完成，而是逐个出口显式
 * 调用 `cleanupConsumedQueuedMessage`。一旦某个 `return true` 分支漏调，条目就会留在
 * 服务端，下次水合时被复活——用户表现为「这条消息又发了一遍」。
 *
 * 标准聊天流那条出口一直是对的，所以这类 bug 不会被常规路径的测试发现；这里对**命令类
 * 出口**逐条钉死，它们才是容易漏的那批。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDescriptor } from '@openAwork/shared';
import type { SendMessageDeps } from './run-send-message.js';

const mocks = vi.hoisted(() => ({
  enqueueCalls: [] as Array<{ itemId: string; sessionId: string }>,
  executeServerCommand: vi.fn(async () => undefined),
  rejectedNotifications: [] as Array<{ itemId: string; sessionId: string; text: string }>,
  removeCalls: [] as Array<{ itemId: string; sessionId: string }>,
  toast: vi.fn(),
}));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createComposerQueueClient: () => ({
      clear: async () => 0,
      claim: async () => ({ claimed: true }),
      claimMany: async (_token: string, _sessionId: string, itemIds: readonly string[]) =>
        itemIds.map((itemId) => ({ claimed: true, itemId })),
      enqueue: async (
        _token: string,
        sessionId: string,
        input: { itemId: string; text: string },
      ) => {
        mocks.enqueueCalls.push({ itemId: input.itemId, sessionId });
        return { created: true, item: {} };
      },
      list: async () => [],
      remove: async (_token: string, sessionId: string, itemId: string) => {
        mocks.removeCalls.push({ itemId, sessionId });
        return true;
      },
    }),
  };
});

vi.mock('../../../utils/chat/composer-queue-events.js', () => ({
  notifyQueuedMessageSendRejected: (payload: {
    itemId: string;
    sessionId: string;
    text: string;
  }) => {
    mocks.rejectedNotifications.push(payload);
  },
}));

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: mocks.toast,
}));

vi.mock('../conversation/composer/server-command-item.js', () => ({
  executeServerCommand: mocks.executeServerCommand,
}));

const { runSendMessage } = await import('./run-send-message.js');

const SERVER_COMMAND = {
  action: { kind: 'compact_session' },
  execution: 'server',
  id: 'compact',
  label: '/compact',
} as unknown as CommandDescriptor;

const CLIENT_COMMAND = {
  action: { kind: 'open_companion_panel' },
  execution: 'client',
  id: 'companion',
  label: '/companion',
} as unknown as CommandDescriptor;

/**
 * 只提供命令类出口实际会读到的字段。
 *
 * `runSendMessage` 解构了数十个 deps，未用到的留空即可——它们在这几条路径上根本不会被
 * 访问。缺失字段用断言绕过而非补齐几十个 stub，测试意图因此保持在「这条出口有没有清理」。
 */
function createDeps(overrides: Partial<SendMessageDeps> = {}): SendMessageDeps {
  return {
    activeSessionRef: { current: 'session-1' },
    composerCommandDescriptors: [],
    currentSessionId: 'session-1',
    gatewayUrl: 'http://gateway.test',
    imageGenerationBusy: false,
    imageGenerationMode: false,
    queuedComposerScope: 'user@example.com:session-1',
    remoteSessionBusyState: null,
    requestSessionListRefresh: vi.fn(),
    setBrowserPreviewUrl: vi.fn(),
    setEditorMode: vi.fn(),
    setStreamError: vi.fn(),
    streaming: false,
    streamingRef: { current: false },
    token: 'token-1',
    ...overrides,
  } as unknown as SendMessageDeps;
}

beforeEach(() => {
  mocks.removeCalls.length = 0;
  mocks.enqueueCalls.length = 0;
  mocks.rejectedNotifications.length = 0;
  mocks.executeServerCommand.mockClear();
  mocks.toast.mockClear();
});

describe('待发队列的消费清理', () => {
  it('内置 /open 命令消费队列条目后，会删掉服务端记录', async () => {
    const result = await runSendMessage(createDeps(), '/open https://example.com', {
      queuedMessageId: 'queued-open',
    });

    expect(result).toBe(true);
    expect(mocks.removeCalls).toEqual([{ itemId: 'queued-open', sessionId: 'session-1' }]);
  });

  it('server slash command 消费队列条目后，会删掉服务端记录', async () => {
    const result = await runSendMessage(
      createDeps({ composerCommandDescriptors: [SERVER_COMMAND] }),
      '/compact',
      { queuedMessageId: 'queued-compact' },
    );

    expect(result).toBe(true);
    expect(mocks.executeServerCommand).toHaveBeenCalledTimes(1);
    expect(mocks.removeCalls).toEqual([{ itemId: 'queued-compact', sessionId: 'session-1' }]);
  });

  it('client slash command 消费队列条目后，会删掉服务端记录', async () => {
    const bumpCompanionPanelSignal = vi.fn();
    const result = await runSendMessage(
      createDeps({
        bumpCompanionPanelSignal,
        composerCommandDescriptors: [CLIENT_COMMAND],
      }),
      '/companion',
      { queuedMessageId: 'queued-companion' },
    );

    expect(result).toBe(true);
    expect(bumpCompanionPanelSignal).toHaveBeenCalledTimes(1);
    expect(mocks.removeCalls).toEqual([{ itemId: 'queued-companion', sessionId: 'session-1' }]);
  });

  it('标准聊天流消费队列条目后,同样会删掉服务端记录', async () => {
    // 回归:待发队列改为服务端落库时,这条出口被漏改——只清本地附件、留下网关记录。
    // 条目会在下一次水合时复活并被再发一遍;那条重发常常撞在会话仍在运行的窗口上,
    // 被单飞锁拒成 SESSION_ALREADY_RUNNING,用户看到「当前会话已有请求正在运行。」
    const ref = <T>(initial: T) => ({ current: initial });
    const stream = vi.fn();
    const result = await runSendMessage(
      createDeps({
        activeModelOption: undefined,
        activeProvider: undefined,
        client: {
          getActiveStreamClientRequestId: () => null,
          stream,
        },
        currentAssistantStreamMessageIdRef: ref<string | null>(null),
        dialogueMode: 'coding',
        effectiveAgentId: '',
        effectiveModelId: 'gpt-5-mini',
        ensureSession: async () => 'session-1',
        reasoningEffort: undefined,
        scrollToBottom: vi.fn(),
        sessionModesHydrated: false,
        sessionModelSelectionSourceRef: ref<string | null>(null),
        setActiveStreamFirstTokenLatencyMs: vi.fn(),
        setActiveStreamRoundStartedAt: vi.fn(),
        setActiveStreamStartedAt: vi.fn(),
        setHasPendingFollowContent: vi.fn(),
        setMessages: vi.fn(),
        setReportedStreamUsage: vi.fn(),
        setRightPanelState: vi.fn(),
        setSessionStateStatus: vi.fn(),
        setShowScrollToBottom: vi.fn(),
        setStoppingStream: vi.fn(),
        setStreamBuffer: vi.fn(),
        setStreamThinkingBlocks: vi.fn(),
        setStreamThinkingBuffer: vi.fn(),
        setStreaming: vi.fn(),
        stoppingStreamRef: ref(false),
        streamRevealNextAllowedAtRef: ref(0),
        streamRevealTargetCodePointsRef: ref<string[]>([]),
        streamRevealTargetRef: ref(''),
        streamRevealVisibleCodePointCountRef: ref(0),
        streamRevealVisibleRef: ref(''),
        streamingRef: ref(false),
        thinkingEnabled: false,
        webSearchEnabled: false,
        yoloMode: false,
      } as unknown as Partial<SendMessageDeps>),
      '普通的一句话',
      { queuedMessageId: 'queued-standard' },
    );

    expect(stream).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
    expect(mocks.removeCalls).toEqual([{ itemId: 'queued-standard', sessionId: 'session-1' }]);
  });

  it('队列来源发送被 SESSION_ALREADY_RUNNING 拒绝时,回流重排而不是报错', async () => {
    const setStreamError = vi.fn();
    const stream = vi.fn(
      (
        _sid: string,
        _text: string,
        handlers: { onError?: (code: string, message?: string) => void },
      ) => {
        handlers.onError?.('SESSION_ALREADY_RUNNING', '当前会话已有请求正在运行。');
      },
    );
    const result = await runSendMessage(
      createDeps({
        activeModelOption: undefined,
        activeProvider: undefined,
        client: {
          getActiveStreamClientRequestId: () => null,
          stream,
        },
        currentAssistantStreamMessageIdRef: { current: null },
        dialogueMode: 'coding',
        effectiveAgentId: '',
        effectiveModelId: 'gpt-5-mini',
        ensureSession: async () => 'session-1',
        reasoningEffort: undefined,
        resetStreamState: vi.fn(),
        scrollToBottom: vi.fn(),
        sessionModesHydrated: false,
        sessionModelSelectionSourceRef: { current: null },
        setActiveStreamFirstTokenLatencyMs: vi.fn(),
        setActiveStreamRoundStartedAt: vi.fn(),
        setActiveStreamStartedAt: vi.fn(),
        setHasPendingFollowContent: vi.fn(),
        setMessages: vi.fn(),
        setReportedStreamUsage: vi.fn(),
        setRightPanelState: vi.fn(),
        setSessionStateStatus: vi.fn(),
        setShowScrollToBottom: vi.fn(),
        setStoppingStream: vi.fn(),
        setStreamBuffer: vi.fn(),
        setStreamThinkingBlocks: vi.fn(),
        setStreamThinkingBuffer: vi.fn(),
        setStreaming: vi.fn(),
        stoppingStreamRef: { current: false },
        streamRevealNextAllowedAtRef: { current: 0 },
        streamRevealTargetCodePointsRef: { current: [] },
        streamRevealTargetRef: { current: '' },
        streamRevealVisibleCodePointCountRef: { current: 0 },
        streamRevealVisibleRef: { current: '' },
        streamingRef: { current: false },
        thinkingEnabled: false,
        webSearchEnabled: false,
        yoloMode: false,
      } as unknown as Partial<SendMessageDeps>),
      '排队的一句话',
      { queuedMessageId: 'queued-rejected' },
    );

    expect(result).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
    // 时序:消费时先删服务端记录 → 被拒后用原 itemId 幂等重写,消息不丢。
    expect(mocks.removeCalls).toEqual([{ itemId: 'queued-rejected', sessionId: 'session-1' }]);
    expect(mocks.enqueueCalls).toEqual([{ itemId: 'queued-rejected', sessionId: 'session-1' }]);
    // 通知编辑器把条目回填到本地队列并安排重试。
    expect(mocks.rejectedNotifications).toHaveLength(1);
    expect(mocks.rejectedNotifications[0]).toMatchObject({
      itemId: 'queued-rejected',
      sessionId: 'session-1',
    });
    // 不按错误终态处理:不弹「当前会话已有请求正在运行。」。
    expect(setStreamError).not.toHaveBeenCalledWith('当前会话已有请求正在运行。');
  });

  it('流已开但 streaming 状态尚未提交时（streamingRef 置位），重复发送被挡下', async () => {
    // 回归:从点击到 startStandardChatStream 置位 streaming 之间有异步窗口(建会话、
    // 传附件),只看 state 会漏判,第二次发送会再起一个流,被网关单飞锁拒成
    // SESSION_ALREADY_RUNNING——用户看到「第一次没反应,再点一次报错」。
    const result = await runSendMessage(
      createDeps({
        ensureSession: async () => 'session-1',
        streamingRef: { current: true },
      }),
      '第一次还没提交状态',
      { queuedMessageId: 'queued-double' },
    );

    expect(result).toBe(false);
    expect(mocks.removeCalls).toEqual([]);
    expect(mocks.enqueueCalls).toEqual([]);
  });

  it('普通发送（非队列来源）不会误删任何服务端记录', async () => {
    // 没有 queuedMessageId：用户直接敲回车发送，与队列无关，不得触发删除。
    await runSendMessage(createDeps(), '/open https://example.com');

    expect(mocks.removeCalls).toEqual([]);
  });

  it('未进入任何会话时只清本地附件，不打远端删除', async () => {
    const result = await runSendMessage(
      createDeps({ activeSessionRef: { current: null } }),
      '/open https://example.com',
      { queuedMessageId: 'queued-open' },
    );

    expect(result).toBe(true);
    expect(mocks.removeCalls).toEqual([]);
  });
});
