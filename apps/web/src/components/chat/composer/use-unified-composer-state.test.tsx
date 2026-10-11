// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type {
  ComposerMenuState,
  WorkspaceFileMentionItem,
} from '../../conversation-runtime/messages/support.js';
import type { UnifiedComposerFeatures } from './UnifiedComposer.js';
import { useComposerInputHistoryStore } from '../../../stores/chat/composer-input-history.js';
import { useChatQueueStore } from '../../../stores/chat/chat-queue.js';
import { useUnifiedComposerState } from './use-unified-composer-state.js';

let hydrationGate: { promise: Promise<void>; resolve: () => void } | null = null;

vi.mock('../../../pages/chat-page/conversation/composer/queued-composer-file-store.js', () => ({
  restoreQueuedComposerFiles: async () => {
    if (hydrationGate) await hydrationGate.promise;
    return { files: [], restored: false };
  },
  persistQueuedComposerFiles: async () => false,
  deleteQueuedComposerFiles: async () => undefined,
}));

interface FakeQueueItem {
  attachmentItems: never[];
  enqueuedAt: number;
  id: string;
  requiresAttachmentRebind: boolean;
  text: string;
}

/**
 * 假网关队列。
 *
 * 待发队列的真相源已从 localStorage 迁到网关，测试因此必须断言「网关里有什么」，
 * 而不是「浏览器快照里有什么」。用 `vi.hoisted` 提前实例化，保证 mock 工厂执行时
 * 该对象已可用（`vi.mock` 会被提升到 import 之前）。
 */
const { fakeQueue } = vi.hoisted(() => ({
  fakeQueue: {
    /** 置 true 后 enqueue 一律失败，用于验证「入队落库失败」的回滚路径。 */
    enqueueShouldFail: false,
    enqueueCalls: [] as Array<{ itemId: string; sessionId: string }>,
    /** 置 true 后 claim 一律返回 false，模拟「另一端正在处理」。 */
    claimHeldByOther: false,
    claimAttempts: 0,
    claimCalls: [] as Array<{ clientId: string; itemId: string; sessionId: string }>,
    itemsBySession: new Map<string, FakeQueueItem[]>(),
    listCalls: 0,
    /** claim 抛错，用于验证「没问成」时条目必须保留而不是消失。 */
    claimShouldThrow: false,
    releaseCalls: [] as Array<{ clientId: string; itemId: string; sessionId: string }>,
    removeCalls: [] as Array<{ itemId: string; sessionId: string }>,
  },
}));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createComposerQueueClient: () => ({
      claim: async (
        _token: string,
        sessionId: string,
        itemId: string,
        input: { clientId: string },
      ) => {
        // 无论成败都计数：抛错路径进不了 claimCalls，缺了它就分不清
        // 「条目被移除」和「claim 被反复重试」。
        fakeQueue.claimAttempts += 1;
        if (fakeQueue.claimShouldThrow) {
          throw new Error('网关不可达');
        }
        fakeQueue.claimCalls.push({ clientId: input.clientId, itemId, sessionId });
        return !fakeQueue.claimHeldByOther;
      },
      clear: async () => 0,
      enqueue: async (
        _token: string,
        sessionId: string,
        input: {
          itemId: string;
          requiresAttachmentRebind: boolean;
          text: string;
        },
      ) => {
        if (fakeQueue.enqueueShouldFail) {
          throw new Error('网关不可用');
        }
        fakeQueue.enqueueCalls.push({ itemId: input.itemId, sessionId });
        const items = fakeQueue.itemsBySession.get(sessionId) ?? [];
        // 与网关一致：同一 itemId 重复入队幂等，不覆盖既有入队时间。
        const existing = items.find((item) => item.id === input.itemId);
        if (existing) {
          return { created: false, item: { ...existing } };
        }
        const item: FakeQueueItem = {
          attachmentItems: [],
          enqueuedAt: items.length + 1,
          id: input.itemId,
          requiresAttachmentRebind: input.requiresAttachmentRebind,
          text: input.text,
        };
        fakeQueue.itemsBySession.set(sessionId, [...items, item]);
        return { created: true, item: { ...item } };
      },
      list: async (_token: string, sessionId: string) => {
        fakeQueue.listCalls += 1;
        return (fakeQueue.itemsBySession.get(sessionId) ?? []).map((item) => ({ ...item }));
      },
      releaseClaim: async (_token: string, sessionId: string, itemId: string, clientId: string) => {
        fakeQueue.releaseCalls.push({ clientId, itemId, sessionId });
        return true;
      },
      remove: async (_token: string, sessionId: string, itemId: string) => {
        fakeQueue.removeCalls.push({ itemId, sessionId });
        const items = fakeQueue.itemsBySession.get(sessionId) ?? [];
        const next = items.filter((item) => item.id !== itemId);
        fakeQueue.itemsBySession.set(sessionId, next);
        return next.length !== items.length;
      },
    }),
  };
});

/** 预置网关侧队列，替代旧测试里对 localStorage 快照的 seeding。 */
function seedBackendQueue(sessionId: string, items: FakeQueueItem[]): void {
  fakeQueue.itemsBySession.set(
    sessionId,
    items.map((item) => ({ ...item })),
  );
}

function backendQueue(sessionId: string): FakeQueueItem[] {
  return fakeQueue.itemsBySession.get(sessionId) ?? [];
}

const TEST_FEATURES = {
  attachments: false,
  voice: false,
  modelPicker: false,
  modelSettings: false,
  webSearch: false,
  imageGen: false,
  promptOptimize: false,
  slashCommands: false,
  mentions: false,
  agentSwitch: false,
  queuedMessages: true,
  permissionMode: false,
} satisfies Required<UnifiedComposerFeatures>;

interface HarnessProps {
  readonly initialInput: string;
  readonly sessionId: string | null;
  readonly sessionBusyState?: 'running' | 'paused' | null;
  readonly streaming?: boolean;
  readonly onSubmit?: () => boolean | Promise<boolean>;
}

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}

function UnifiedComposerStateHarness(props: HarnessProps) {
  const {
    initialInput,
    sessionId,
    sessionBusyState = null,
    streaming = false,
    onSubmit = async () => true,
  } = props;
  const [input, setInput] = useState(initialInput);
  const [attachmentItems, setAttachmentItems] = useState<AttachmentItem[]>([]);
  const [workspaceFileItems, setWorkspaceFileItems] = useState<WorkspaceFileMentionItem[]>([]);
  const [composerMenu, setComposerMenu] = useState<ComposerMenuState>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const state = useUnifiedComposerState({
    sessionId,
    gatewayUrl: 'http://gateway.test',
    token: 'token-1',
    currentUserEmail: 'user@example.com',
    streaming,
    stoppingStream: false,
    canStopSession: false,
    stopCapability: 'none',
    sessionBusyState,
    providers: [],
    activeProviderId: 'openai',
    activeModelId: 'gpt-5-mini',
    dialogueMode: 'coding',
    manualAgentId: '',
    webSearchEnabled: false,
    thinkingEnabled: false,
    features: TEST_FEATURES,
    imageReferenceArtifacts: [],
    selectedImageReferenceArtifactId: null,
    onSubmit,
    onStop: () => undefined,
    stopActiveMessage: () => undefined,
    input,
    setInput,
    attachmentItems,
    setAttachmentItems,
    workspaceFileItems,
    setWorkspaceFileItems,
    composerMenu,
    setComposerMenu,
    textareaRef,
  });

  return (
    <div>
      <textarea
        aria-label="composer"
        ref={state.textareaRef}
        value={state.input}
        onChange={state.handleInputChange}
        onKeyDown={state.handleKeyDown}
      />
      <button type="button" onClick={() => void state.sendMessage()}>
        send
      </button>
      <button type="button" onClick={() => void state.enqueueComposerMessage()}>
        queue
      </button>
      <button
        type="button"
        onClick={() =>
          state.appendFiles([new File(['binary'], 'screenshot.png', { type: 'image/png' })])
        }
      >
        attach
      </button>
      <span data-testid="attachment-count">{state.attachmentItems.length}</span>
      {/* 队列条数探针：断言「条目是否还在」比匹配文本更稳，也不会被输入框残留干扰。 */}
      <span data-testid="queue-count">{state.queuedComposerPreviews.length}</span>
      <span data-testid="stream-error">{state.streamError ?? ''}</span>
      <button
        type="button"
        onClick={() => {
          const combined = '折叠的粘贴文本\n\n用户追加的输入';
          setInput(combined);
          void state.sendMessage(combined);
        }}
      >
        send-override
      </button>
      {state.queuedComposerPreviews.map((preview) => (
        <span key={preview.id}>
          {preview.title}
          <button
            type="button"
            onClick={() => state.removeQueuedComposerMessage(preview.id)}
          >{`remove:${preview.id}`}</button>
        </span>
      ))}
    </div>
  );
}

afterEach(() => {
  cleanup();
  hydrationGate = null;
  useComposerInputHistoryStore.setState((state) => ({ ...state, historyByScope: {} }));
  useChatQueueStore.setState({ queuesByScope: {} });
  fakeQueue.itemsBySession.clear();
  fakeQueue.enqueueCalls.length = 0;
  fakeQueue.removeCalls.length = 0;
  fakeQueue.enqueueShouldFail = false;
  fakeQueue.claimCalls.length = 0;
  fakeQueue.claimAttempts = 0;
  fakeQueue.claimHeldByOther = false;
  fakeQueue.claimShouldThrow = false;
  fakeQueue.listCalls = 0;
  fakeQueue.releaseCalls.length = 0;
  vi.restoreAllMocks();
});

describe('useUnifiedComposerState', () => {
  const SCOPE_A = 'user@example.com:session-1';
  const SCOPE_B = 'user@example.com:session-2';

  function getComposer(view: ReturnType<typeof render>) {
    const composer = view.getByLabelText('composer');
    if (!(composer instanceof HTMLTextAreaElement)) {
      throw new TypeError('Expected composer textarea.');
    }
    return composer;
  }

  it('会把 pending scope 的首条输入迁移到真实 session scope', async () => {
    const onSubmit = vi.fn(async () => true);
    const view = render(
      <UnifiedComposerStateHarness initialInput="首条输入" sessionId={null} onSubmit={onSubmit} />,
    );

    fireEvent.click(view.getByText('send'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(getComposer(view).value).toBe('');
    });

    view.rerender(
      <UnifiedComposerStateHarness initialInput="" sessionId="session-1" onSubmit={onSubmit} />,
    );

    fireEvent.keyDown(getComposer(view), { key: 'ArrowUp' });
    expect(getComposer(view).value).toBe('首条输入');
  });

  it('session 在提交完成前切换时也会把 pending 历史迁移到真实 session scope', async () => {
    const deferredSubmit = createDeferred<boolean>();
    const onSubmit = vi.fn(() => deferredSubmit.promise);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="竞态首条输入"
        sessionId={null}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('send'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <UnifiedComposerStateHarness initialInput="" sessionId="session-1" onSubmit={onSubmit} />,
    );

    deferredSubmit.resolve(true);

    const sessionScope = 'http://gateway.test::user@example.com::session:session-1';
    await waitFor(() => {
      expect(useComposerInputHistoryStore.getState().historyByScope[sessionScope]).toEqual([
        '竞态首条输入',
      ]);
    });

    fireEvent.keyDown(getComposer(view), { key: 'ArrowUp' });
    expect(getComposer(view).value).toBe('竞态首条输入');
  });

  it('提交成功但期间用户改了新草稿时，不会清掉新的输入', async () => {
    const deferredSubmit = createDeferred<boolean>();
    const onSubmit = vi.fn(() => deferredSubmit.promise);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="原始待发文本"
        sessionId="session-1"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('send'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(getComposer(view), { target: { value: '新的草稿' } });
    deferredSubmit.resolve(true);

    await waitFor(() => {
      expect(getComposer(view).value).toBe('新的草稿');
    });

    const sessionScope = 'http://gateway.test::user@example.com::session:session-1';
    expect(useComposerInputHistoryStore.getState().historyByScope[sessionScope]).toEqual([
      '原始待发文本',
    ]);
  });

  it('提交成功但用户把新草稿改回原文时，仍不会误清空新的输入', async () => {
    const deferredSubmit = createDeferred<boolean>();
    const onSubmit = vi.fn(() => deferredSubmit.promise);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="会重复的文本"
        sessionId="session-1"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('send'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(getComposer(view), { target: { value: '会重复的文本-编辑中' } });
    fireEvent.change(getComposer(view), { target: { value: '会重复的文本' } });
    deferredSubmit.resolve(true);

    await waitFor(() => {
      expect(getComposer(view).value).toBe('会重复的文本');
    });

    const sessionScope = 'http://gateway.test::user@example.com::session:session-1';
    expect(useComposerInputHistoryStore.getState().historyByScope[sessionScope]).toEqual([
      '会重复的文本',
    ]);
  });

  it('queued composer 入口也会写入输入历史', async () => {
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="需要排队的消息"
        sessionId="session-1"
        sessionBusyState="running"
      />,
    );

    fireEvent.click(view.getByText('queue'));
    await waitFor(() => {
      expect(getComposer(view).value).toBe('');
    });

    fireEvent.keyDown(getComposer(view), { key: 'ArrowUp' });
    expect(getComposer(view).value).toBe('需要排队的消息');
  });

  it('折叠粘贴合并后的文本会直接作为提交内容，且不因草稿写回而漏掉清空', async () => {
    const deferredSubmit = createDeferred<boolean>();
    const onSubmit = vi.fn(() => deferredSubmit.promise);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="用户追加的输入"
        sessionId="session-1"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('send-override'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ text: '折叠的粘贴文本\n\n用户追加的输入' }),
    );
    // 发送前的写回会让草稿修订号变化，此时输入框里仍是完整文本
    expect(getComposer(view).value).toBe('折叠的粘贴文本\n\n用户追加的输入');

    deferredSubmit.resolve(true);

    await waitFor(() => {
      expect(getComposer(view).value).toBe('');
    });
  });

  it('上层明确返回 false 时会保留输入且不会把输入写入历史', async () => {
    const onSubmit = vi.fn(async () => false);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="不会写入历史"
        sessionId="session-1"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('send'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(getComposer(view).value).toBe('不会写入历史');
    });

    fireEvent.change(getComposer(view), { target: { value: '' } });
    fireEvent.keyDown(getComposer(view), { key: 'ArrowUp' });
    expect(getComposer(view).value).toBe('');
  });

  it('会话 A 流式中入队后切到空闲会话 B，不会把队列消息发送到 B', async () => {
    const onSubmit = vi.fn(async () => true);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="追加到 A 的消息"
        sessionId="session-1"
        streaming
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('queue'));
    await waitFor(() => {
      expect(backendQueue('session-1')).toHaveLength(1);
    });
    expect(onSubmit).not.toHaveBeenCalled();

    // 切到空闲的 B：旧会话队列不得被 flush 到 B
    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-2"
        streaming={false}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => {
      expect(backendQueue('session-2')).toHaveLength(0);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('从 A 切到已有队列的 B 时，不会用 A 的陈旧队列覆盖 B', async () => {
    seedBackendQueue('session-2', [
      {
        attachmentItems: [],
        enqueuedAt: 1,
        id: 'persisted-b',
        requiresAttachmentRebind: false,
        text: 'B 原有的排队消息',
      },
    ]);

    const onSubmit = vi.fn(async () => true);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="A 的排队消息"
        sessionId="session-1"
        streaming
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('queue'));
    await waitFor(() => {
      expect(backendQueue('session-1')).toHaveLength(1);
    });

    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-2"
        streaming={false}
        onSubmit={onSubmit}
      />,
    );

    // B 空闲，flush 只应发送 B 自己的队列消息（A 的陈旧队列不得被发送）
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ text: 'B 原有的排队消息' }));
    // A 的条目仍留在 A 名下，不会被 B 的 flush 带走。
    expect(backendQueue('session-1').map((item) => item.id)).toHaveLength(1);
  });

  it('切到已有队列的 B 后，在水合完成前入队的新消息不会被水合结果覆盖', async () => {
    seedBackendQueue('session-2', [
      {
        attachmentItems: [],
        enqueuedAt: 1,
        id: 'persisted-b1',
        requiresAttachmentRebind: false,
        text: 'B 原有 1',
      },
      {
        attachmentItems: [],
        enqueuedAt: 2,
        id: 'persisted-b2',
        requiresAttachmentRebind: false,
        text: 'B 原有 2',
      },
    ]);

    const onSubmit = vi.fn(async () => true);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="A 的排队消息"
        sessionId="session-1"
        streaming
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('queue'));
    await waitFor(() => {
      expect(backendQueue('session-1')).toHaveLength(1);
    });

    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-2"
        streaming
        onSubmit={onSubmit}
      />,
    );

    // hydration 尚未完成，立即入队新消息
    fireEvent.change(getComposer(view), { target: { value: 'B 新入队消息' } });
    fireEvent.click(view.getByText('queue'));

    await waitFor(() => {
      expect(backendQueue('session-2').map((item) => item.text)).toEqual([
        'B 原有 1',
        'B 原有 2',
        'B 新入队消息',
      ]);
    });
    expect(backendQueue('session-1').map((item) => item.text)).toEqual(['A 的排队消息']);
  });

  it('入队落库失败时，文本与附件一起退回输入框', async () => {
    const onSubmit = vi.fn(async () => true);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="带附件的排队消息"
        sessionId="session-1"
        streaming
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('attach'));
    await waitFor(() => {
      expect(view.getByTestId('attachment-count').textContent).toBe('1');
    });

    fakeQueue.enqueueShouldFail = true;
    fireEvent.click(view.getByText('queue'));

    // 文本必须回到输入框：clearComposerDraft 在入队时已清空过，不回滚就是静默丢失。
    await waitFor(() => {
      expect(getComposer(view).value).toBe('带附件的排队消息');
    });
    // 附件同样要回来——只还文本等于连带把文件丢了，比丢文本更严重。
    await waitFor(() => {
      expect(view.getByTestId('attachment-count').textContent).toBe('1');
    });
    // 队列不留残影，服务端也不该有这条记录。
    expect(backendQueue('session-1')).toHaveLength(0);
    expect(view.getByTestId('stream-error').textContent).toContain('退回输入框');
    // 流式中不得被自动 flush 出去。
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('入队落库失败时，纯文本消息也会退回并给出提示', async () => {
    const onSubmit = vi.fn(async () => true);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="纯文本排队"
        sessionId="session-1"
        streaming
        onSubmit={onSubmit}
      />,
    );

    fakeQueue.enqueueShouldFail = true;
    fireEvent.click(view.getByText('queue'));

    await waitFor(() => {
      expect(getComposer(view).value).toBe('纯文本排队');
    });
    expect(backendQueue('session-1')).toHaveLength(0);
    expect(fakeQueue.enqueueCalls).toHaveLength(0);
  });

  it('发送权被另一端持有时，本端不发送且丢弃本地副本', async () => {
    const onSubmit = vi.fn(async () => true);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="另一端正在发的消息"
        sessionId="session-1"
        streaming
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('queue'));
    await waitFor(() => {
      expect(backendQueue('session-1')).toHaveLength(1);
    });

    // 切到空闲触发 flush，但服务端报告该条目已被另一端持有
    fakeQueue.claimHeldByOther = true;
    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-1"
        streaming={false}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => {
      expect(fakeQueue.claimCalls).toHaveLength(1);
    });
    // 核心断言：绝不重复发送同一条。
    expect(onSubmit).not.toHaveBeenCalled();
    // 本地副本作废，避免下一轮又去 claim 同一条形成死循环。
    await waitFor(() => {
      expect(view.queryByText('另一端正在发的消息')).toBeNull();
    });
    // 服务端记录仍在——由持有权的那一端负责发出并删除。
    expect(backendQueue('session-1')).toHaveLength(1);
  });

  it('发送权没问成时，保留本地条目而不是让它消失', async () => {
    const onSubmit = vi.fn(async () => true);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="网关暂时不可达"
        sessionId="session-1"
        streaming
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('queue'));
    await waitFor(() => {
      expect(backendQueue('session-1')).toHaveLength(1);
    });
    expect(view.getByTestId('queue-count').textContent).toBe('1');

    fakeQueue.claimShouldThrow = true;
    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-1"
        streaming={false}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => {
      expect(fakeQueue.claimAttempts).toBe(1);
    });
    expect(onSubmit).not.toHaveBeenCalled();
    // 与「他人持有」相反：所有权未知时必须保留条目，否则消息会静默消失。
    expect(view.getByTestId('queue-count').textContent).toBe('1');

    // 网关恢复后应能自动补发，无需用户重新操作。
    fakeQueue.claimShouldThrow = false;
    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: 5_000 },
    );
  });

  it('发送失败时交还发送权并回填队首', async () => {
    // 第一次失败、第二次成功：模拟真实的一次抖动。
    // 这里刻意不让 onSubmit 永远返回 false——那会暴露 flush 的紧密重试问题，
    // 属于既有缺陷、不在本次改动范围，测试不去固化那种行为。
    const onSubmit = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="发不出去的消息"
        sessionId="session-1"
        streaming
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('queue'));
    await waitFor(() => {
      expect(backendQueue('session-1')).toHaveLength(1);
    });

    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-1"
        streaming={false}
        onSubmit={onSubmit}
      />,
    );

    // 第一次失败后立即回填并自动重试，第二次成功——两跳之间没有可稳定观察的中间态，
    // 因此只断言最终结果：交还过发送权、共发送两次、队列清空。
    await waitFor(() => {
      expect(fakeQueue.releaseCalls).toHaveLength(1);
    });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });
    expect(view.getByTestId('queue-count').textContent).toBe('0');
  });

  it('flush 发送期间切走且 onSubmit 返回 false 时，消息回填到原会话而不是新会话', async () => {
    const deferredSend = createDeferred<boolean>();
    const onSubmit = vi.fn(() => deferredSend.promise);
    const view = render(
      <UnifiedComposerStateHarness
        initialInput="会被回填的消息"
        sessionId="session-1"
        streaming={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('queue'));
    // flush 条件满足（非流式），onSubmit 挂起
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    // 切到 B 后再让发送失败
    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-2"
        streaming={false}
        onSubmit={onSubmit}
      />,
    );
    deferredSend.resolve(false);

    await waitFor(() => {
      expect(
        useChatQueueStore.getState().queuesByScope[SCOPE_A]?.map((item) => item.text),
      ).toContain('会被回填的消息');
    });
    expect(useChatQueueStore.getState().queuesByScope[SCOPE_B]).toBeUndefined();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('A 的在途 flush 结算后，不会清掉 B 的在途 flush 标记', async () => {
    const deferredA = createDeferred<boolean>();
    const onSubmit = vi.fn((payload: { text: string }) =>
      payload.text === 'A 在途消息' ? deferredA.promise : Promise.resolve(true),
    );

    const view = render(
      <UnifiedComposerStateHarness
        initialInput="A 在途消息"
        sessionId="session-1"
        streaming={false}
        onSubmit={onSubmit as unknown as () => boolean | Promise<boolean>}
      />,
    );

    // A 队列 flush 启动，onSubmit 挂起
    fireEvent.click(view.getByText('queue'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    // 切到 B，B 立即 flush 自己的队列
    seedBackendQueue('session-2', [
      {
        attachmentItems: [],
        enqueuedAt: 1,
        id: 'b-inflight',
        requiresAttachmentRebind: false,
        text: 'B 在途消息',
      },
    ]);
    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-2"
        streaming={false}
        onSubmit={onSubmit as unknown as () => boolean | Promise<boolean>}
      />,
    );
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    // A 的挂起发送此刻才结算：不得干扰 B 的在途标记
    deferredA.resolve(true);

    // 触发一次 B 的 flush 依赖变化（重新挂载同一 session 触发 re-render 不够，直接改 streaming）
    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-2"
        streaming
        onSubmit={onSubmit as unknown as () => boolean | Promise<boolean>}
      />,
    );
    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-2"
        streaming={false}
        onSubmit={onSubmit as unknown as () => boolean | Promise<boolean>}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    // B 的每条消息只发送一次，未因 A 结算而被重复启动
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls.filter((call) => call[0]?.text === 'B 在途消息')).toHaveLength(1);
  });
});
