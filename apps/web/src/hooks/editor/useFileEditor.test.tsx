// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth/auth.js';
import { EMPTY_READ_IDENTITY, useUIStateStore } from '../../stores/ui/uiState.js';

const workspaceClientMocks = vi.hoisted(() => ({
  findByName: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: () => workspaceClientMocks,
}));

import { useFileEditor } from './useFileEditor.js';

const WORKSPACE_ROOT = 'E:\\01.Projects\\OpenAWork';
const VALID_PATH = 'E:\\01.Projects\\OpenAWork\\src\\index.ts';
const STALE_PATH = 'E:\\01.Projects\\tissue\\alembic.ini';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  workspaceClientMocks.readFile.mockImplementation(async (_token: string, path: string) => ({
    content: `// ${path}`,
    truncated: false,
  }));
  useAuthStore.setState({
    accessToken: 'token-test',
    email: 'qa@example.com',
    gatewayUrl: 'http://localhost:3000',
    refreshToken: null,
    tokenExpiresAt: null,
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
  useUIStateStore.setState((state) => ({
    ...state,
    readIdentity: EMPTY_READ_IDENTITY,
    openFilePathsByWorkspace: {
      [WORKSPACE_ROOT]: [VALID_PATH, STALE_PATH],
    },
    activeFilePathByWorkspace: {
      [WORKSPACE_ROOT]: STALE_PATH,
    },
  }));
});

afterEach(() => {
  cleanup();
});

describe('useFileEditor', () => {
  it('恢复标签时丢弃当前工作区之外的历史路径，避免跨工作区读取', async () => {
    const { result } = renderHook(() => useFileEditor(WORKSPACE_ROOT));

    await waitFor(() => {
      expect(result.current.openFiles.map((file) => file.path)).toEqual([VALID_PATH]);
    });

    expect(workspaceClientMocks.readFile).toHaveBeenCalledTimes(1);
    expect(workspaceClientMocks.readFile).toHaveBeenCalledWith('token-test', VALID_PATH, {
      workspaceRoot: WORKSPACE_ROOT,
    });
    expect(workspaceClientMocks.readFile).not.toHaveBeenCalledWith(
      expect.anything(),
      STALE_PATH,
      expect.anything(),
    );
    expect(useUIStateStore.getState().openFilePathsByWorkspace[WORKSPACE_ROOT]).toEqual([
      VALID_PATH,
    ]);
    expect(useUIStateStore.getState().activeFilePathByWorkspace[WORKSPACE_ROOT]).toBeUndefined();

    act(() => {
      useUIStateStore.getState().setOpenFilePathsForWorkspace(WORKSPACE_ROOT, []);
    });
  });

  it('SSH 远端身份下saveFile 带身份下发写请求（写回已打通）', async () => {
    // 此前这里是「拦截并提示不支持」——网关 PUT /workspace/file 的 SSH 分支
    // 补齐后该限制已成过时约束，改为下发身份走远端写入。
    useUIStateStore.getState().setReadIdentity({
      sessionId: 'sess-ssh-1',
      sshConnectionId: null,
      remote: true,
    });

    const { result } = renderHook(() => useFileEditor(WORKSPACE_ROOT));

    await waitFor(() => {
      expect(result.current.openFiles.map((file) => file.path)).toEqual([VALID_PATH]);
    });

    await act(async () => {
      await result.current.saveFile(VALID_PATH);
    });

    // 身份必须下发：缺它网关会写到本机同名路径（静默写错位置）。
    expect(workspaceClientMocks.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      VALID_PATH,
      expect.any(String),
      expect.objectContaining({ sessionId: 'sess-ssh-1', workspaceRoot: WORKSPACE_ROOT }),
    );
    expect(result.current.saveError).toBeNull();

    act(() => {
      useUIStateStore.getState().setOpenFilePathsForWorkspace(WORKSPACE_ROOT, []);
    });
  });
});
