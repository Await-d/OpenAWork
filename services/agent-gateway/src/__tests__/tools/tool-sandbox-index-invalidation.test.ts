import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';

const mocks = vi.hoisted(() => ({
  transitionToolToRunningMock: vi.fn(),
  invalidateForToolCallMock: vi.fn<(sessionId: string, toolName: string) => void>(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn((query: string) =>
    query.includes('SELECT user_id FROM sessions') ? { user_id: 'user-1' } : undefined,
  ),
  sqliteRun: vi.fn(() => undefined),
}));

vi.mock('../../message/message-store-v2.js', async () => {
  const actual = await vi.importActual<typeof MessageStoreV2>('../../message/message-store-v2.js');
  return {
    ...actual,
    transitionToolToRunning: mocks.transitionToolToRunningMock,
  };
});

vi.mock('../../workspace/workspace-file-index-invalidation.js', () => ({
  invalidateWorkspaceFileIndexForToolCall: mocks.invalidateForToolCallMock,
}));

describe('ToolSandbox.execute 索引失效接线', () => {
  beforeEach(() => {
    mocks.transitionToolToRunningMock.mockReset();
    mocks.invalidateForToolCallMock.mockReset();
  });

  it('可写工具执行完（含失败返回）后按会话失效索引', async () => {
    const { ToolSandbox } = await import('../../tools/tool-sandbox.js');
    const sandbox = new ToolSandbox({ defaultTimeoutMs: 1000 });

    await sandbox.execute(
      { toolCallId: 'call-edit', toolName: 'edit', rawInput: {} },
      new AbortController().signal,
      'session-1',
    );

    expect(mocks.invalidateForToolCallMock).toHaveBeenCalledWith('session-1', 'edit');
  }, 20_000);

  it('带 functions. 前缀的工具名会先剥前缀再交给失效桥接', async () => {
    const { ToolSandbox } = await import('../../tools/tool-sandbox.js');
    const sandbox = new ToolSandbox({ defaultTimeoutMs: 1000 });

    await sandbox.execute(
      { toolCallId: 'call-prefixed-read', toolName: 'functions.read', rawInput: {} },
      new AbortController().signal,
      'session-1',
    );

    expect(mocks.invalidateForToolCallMock).toHaveBeenCalledWith('session-1', 'read');
  }, 20_000);
});
