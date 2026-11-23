import { beforeEach, expect, it, vi } from 'vitest';
import { runSendMessage } from './run-send-message.js';
import type { SendMessageDeps } from './run-send-message.js';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@openAwork/web-client', async (original) => ({
  ...(await original<typeof import('@openAwork/web-client')>()),
  createMessageLimitsClient: () => ({ read: mocks.read }),
  createComposerQueueClient: () => ({ remove: mocks.remove }),
}));
vi.mock('../conversation/composer/prepare-standard-chat-send-input.js', () => ({
  prepareStandardChatSendInput: mocks.prepare,
}));
vi.mock('../conversation/composer/start-standard-chat-stream.js', () => ({
  startStandardChatStream: mocks.start,
}));
vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({ toast: mocks.toast }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({ text: '正文\n附件摘要'.repeat(200) });
  mocks.read.mockResolvedValue({ maxChars: 1024 });
});

function createDeps() {
  return {
    activeSessionRef: { current: 'session' },
    streamingRef: { current: false },
    composerCommandDescriptors: [],
    ensureSession: async () => ({ sessionId: 'session' }),
    gatewayUrl: 'http://limits.test',
    token: 'token',
    setStreamError: vi.fn(),
    setInput: vi.fn(),
    setMessages: vi.fn(),
    client: { stream: vi.fn() },
  } as unknown as SendMessageDeps;
}

it.each(['over-limit', 'read-failure', 'prepare-failure'])(
  '%s 保留输入、附件与队列且不启动流',
  async (failure) => {
    if (failure === 'read-failure') mocks.read.mockRejectedValueOnce(new Error('离线'));
    if (failure === 'prepare-failure') mocks.prepare.mockRejectedValueOnce(new Error('上传失败'));
    const deps = createDeps();
    const files = [new File(['附件'], 'notes.txt')];
    expect(
      await runSendMessage(deps, '正文', { queuedFiles: files, queuedMessageId: 'head' }),
    ).toBe(false);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(deps.client.stream).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(deps.setInput).not.toHaveBeenCalled();
    expect(deps.setMessages).not.toHaveBeenCalled();
    expect(files).toHaveLength(1);
    expect(deps.setStreamError).toHaveBeenLastCalledWith(expect.stringContaining('内容已保留'));
    expect(mocks.toast).toHaveBeenCalled();
    if (failure !== 'prepare-failure') {
      expect(mocks.read).toHaveBeenCalledWith('token');
      expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.read.mock.invocationCallOrder[0]!,
      );
    }
  },
);
