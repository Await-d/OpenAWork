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
      expect(useChatQueueStore.getState().queuesByScope[SCOPE_A]).toHaveLength(1);
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
      expect(useChatQueueStore.getState().queuesByScope[SCOPE_B]).toBeUndefined();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('从 A 切到已有持久化队列的 B 时，不会用 A 的陈旧队列覆盖 B', async () => {
    useChatQueueStore.getState().replaceQueue(SCOPE_B, [
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
      expect(useChatQueueStore.getState().queuesByScope[SCOPE_A]).toHaveLength(1);
    });

    view.rerender(
      <UnifiedComposerStateHarness
        initialInput=""
        sessionId="session-2"
        streaming={false}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => {
      expect(useChatQueueStore.getState().queuesByScope[SCOPE_B]?.map((item) => item.id)).toEqual([
        'persisted-b',
      ]);
    });

    // B 空闲，flush 只应发送 B 自己的队列消息（A 的陈旧队列不得被发送）
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ text: 'B 原有的排队消息' }));
    expect(
      useChatQueueStore.getState().queuesByScope[SCOPE_A]?.map((item) => item.id),
    ).toHaveLength(1);
  });

  it('切到已有持久化队列的 B 后，在水合完成前入队的新消息不会被水合结果覆盖', async () => {
    useChatQueueStore.getState().replaceQueue(SCOPE_B, [
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
      expect(useChatQueueStore.getState().queuesByScope[SCOPE_A]).toHaveLength(1);
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
      expect(useChatQueueStore.getState().queuesByScope[SCOPE_B]?.map((item) => item.text)).toEqual(
        ['B 原有 1', 'B 原有 2', 'B 新入队消息'],
      );
    });
    expect(useChatQueueStore.getState().queuesByScope[SCOPE_A]?.map((item) => item.text)).toEqual([
      'A 的排队消息',
    ]);
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
    useChatQueueStore.getState().replaceQueue(SCOPE_B, [
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
