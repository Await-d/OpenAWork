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
import { useUnifiedComposerState } from './use-unified-composer-state.js';

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
} satisfies Required<UnifiedComposerFeatures>;

interface HarnessProps {
  readonly initialInput: string;
  readonly sessionId: string | null;
  readonly sessionBusyState?: 'running' | 'paused' | null;
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
  const { initialInput, sessionId, sessionBusyState = null, onSubmit = async () => true } = props;
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
    streaming: false,
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
    </div>
  );
}

afterEach(() => {
  cleanup();
  useComposerInputHistoryStore.setState((state) => ({ ...state, historyByScope: {} }));
  vi.restoreAllMocks();
});

describe('useUnifiedComposerState', () => {
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
});
