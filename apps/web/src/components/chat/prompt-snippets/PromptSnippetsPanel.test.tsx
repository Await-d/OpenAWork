// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptSnippetsPanel } from './PromptSnippetsPanel.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

const mockClient = vi.hoisted(() => ({
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  listSnippets: vi.fn(),
  createSnippet: vi.fn(),
  updateSnippet: vi.fn(),
  deleteSnippet: vi.fn(),
}));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createPromptSnippetsClient: vi.fn(() => mockClient),
  };
});

function renderPanel(token: string | null) {
  return render(
    <PromptSnippetsPanel
      open
      gatewayUrl="http://localhost:3000"
      token={token}
      onInject={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  mockClient.listGroups.mockReset();
  mockClient.createGroup.mockReset();
  mockClient.updateGroup.mockReset();
  mockClient.deleteGroup.mockReset();
  mockClient.listSnippets.mockReset();
  mockClient.createSnippet.mockReset();
  mockClient.updateSnippet.mockReset();
  mockClient.deleteSnippet.mockReset();

  mockClient.listGroups.mockResolvedValue([]);
  mockClient.listSnippets.mockResolvedValue([]);
  mockClient.createGroup.mockResolvedValue({
    id: 'group-1',
    userId: 'u-1',
    name: '新分组',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  mockClient.createSnippet.mockResolvedValue({
    id: 'snippet-1',
    userId: 'u-1',
    groupId: 'group-1',
    title: '提示词一',
    content: '内容一',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async () => undefined),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PromptSnippetsPanel', () => {
  it('未登录时展示明确提示而不是空白状态', async () => {
    renderPanel(null);

    expect(await screen.findByText('登录后可使用快捷提示词。')).toBeTruthy();
    expect(mockClient.listGroups).not.toHaveBeenCalled();
    expect(mockClient.listSnippets).not.toHaveBeenCalled();
  });

  it('加载失败时展示错误并支持重试', async () => {
    mockClient.listGroups.mockRejectedValueOnce(new Error('读取快捷提示词失败。'));

    renderPanel('token-1');

    expect(await screen.findByText('读取快捷提示词失败。')).toBeTruthy();

    mockClient.listGroups.mockResolvedValueOnce([
      {
        id: 'group-1',
        userId: 'u-1',
        name: '测试分组',
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mockClient.listSnippets.mockResolvedValueOnce([]);

    fireEvent.click(screen.getByText('重试'));

    expect(await screen.findByText('测试分组')).toBeTruthy();
    await waitFor(() => {
      expect(mockClient.listGroups).toHaveBeenCalledTimes(2);
    });
  });

  it('跨 token 的旧请求不会覆盖最新分组状态', async () => {
    const groupADeferred = createDeferred<
      Array<{
        id: string;
        userId: string;
        name: string;
        order: number;
        createdAt: string;
        updatedAt: string;
      }>
    >();
    const snippetADeferred = createDeferred<
      Array<{
        id: string;
        userId: string;
        groupId: string;
        title: string;
        content: string;
        order: number;
        createdAt: string;
        updatedAt: string;
      }>
    >();
    const groupBDeferred = createDeferred<
      Array<{
        id: string;
        userId: string;
        name: string;
        order: number;
        createdAt: string;
        updatedAt: string;
      }>
    >();
    const snippetBDeferred = createDeferred<
      Array<{
        id: string;
        userId: string;
        groupId: string;
        title: string;
        content: string;
        order: number;
        createdAt: string;
        updatedAt: string;
      }>
    >();

    mockClient.listGroups.mockImplementation((token: string) => {
      if (token === 'token-a') {
        return groupADeferred.promise;
      }
      return groupBDeferred.promise;
    });
    mockClient.listSnippets.mockImplementation((token: string) => {
      if (token === 'token-a') {
        return snippetADeferred.promise;
      }
      return snippetBDeferred.promise;
    });

    const view = renderPanel('token-a');
    view.rerender(
      <PromptSnippetsPanel
        open
        gatewayUrl="http://localhost:3000"
        token="token-b"
        onInject={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await act(async () => {
      groupBDeferred.resolve([
        {
          id: 'group-b',
          userId: 'u-b',
          name: '账号B分组',
          order: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      snippetBDeferred.resolve([]);
      await Promise.resolve();
    });

    expect(await screen.findByText('账号B分组')).toBeTruthy();

    await act(async () => {
      groupADeferred.resolve([
        {
          id: 'group-a',
          userId: 'u-a',
          name: '账号A分组',
          order: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      snippetADeferred.resolve([]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText('账号A分组')).toBeNull();
    });
  });

  it('创建分组失败时对可疑错误做脱敏回退', async () => {
    mockClient.createGroup.mockRejectedValueOnce(
      new Error('https://secret.example.com/token?value=123'),
    );

    renderPanel('token-1');

    fireEvent.click(await screen.findByTitle('添加分组'));
    fireEvent.change(screen.getByPlaceholderText('分组名称'), { target: { value: '失败分组' } });
    fireEvent.click(screen.getByText('创建'));

    expect(await screen.findByText('创建提示词分组失败，请稍后重试。')).toBeTruthy();
    expect(screen.queryByText('https://secret.example.com/token?value=123')).toBeNull();
  });

  it('创建提示词失败时展示操作错误', async () => {
    mockClient.listGroups.mockResolvedValueOnce([
      {
        id: 'group-1',
        userId: 'u-1',
        name: '默认分组',
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mockClient.createSnippet.mockRejectedValueOnce(new Error('创建提示词失败。'));

    renderPanel('token-1');

    expect(await screen.findByText('默认分组')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /添加提示词/u }));
    fireEvent.change(screen.getByPlaceholderText('标题（简短描述）'), {
      target: { value: '失败提示词' },
    });
    fireEvent.change(screen.getByPlaceholderText('提示词内容'), {
      target: { value: '需要失败的内容' },
    });
    fireEvent.click(screen.getByText('创建'));

    expect(await screen.findByText('创建提示词失败。')).toBeTruthy();
  });

  it('复制失败时展示权限提示而不是成功态', async () => {
    mockClient.listGroups.mockResolvedValueOnce([
      {
        id: 'group-1',
        userId: 'u-1',
        name: '默认分组',
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mockClient.listSnippets.mockResolvedValueOnce([
      {
        id: 'snippet-1',
        userId: 'u-1',
        groupId: 'group-1',
        title: '提示词一',
        content: '内容一',
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('Permission denied');
        }),
      },
    });

    renderPanel('token-1');

    expect(await screen.findByText('提示词一')).toBeTruthy();
    fireEvent.click(screen.getByTitle('复制'));

    expect(await screen.findByText('复制提示词失败，请检查剪贴板权限后重试。')).toBeTruthy();
    expect(screen.queryByText('✓')).toBeNull();
  });
});
