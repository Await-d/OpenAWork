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
  executeServerCommand: vi.fn(async () => undefined),
  removeCalls: [] as Array<{ itemId: string; sessionId: string }>,
  toast: vi.fn(),
}));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createComposerQueueClient: () => ({
      clear: async () => 0,
      enqueue: async () => ({ created: true, item: {} }),
      list: async () => [],
      remove: async (_token: string, sessionId: string, itemId: string) => {
        mocks.removeCalls.push({ itemId, sessionId });
        return true;
      },
    }),
  };
});

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
    token: 'token-1',
    ...overrides,
  } as unknown as SendMessageDeps;
}

beforeEach(() => {
  mocks.removeCalls.length = 0;
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
