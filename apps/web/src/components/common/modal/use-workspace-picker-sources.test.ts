import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspacePickerSources } from './use-workspace-picker-sources.js';

const gatewayUrl = 'http://localhost:3000';

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: vi.fn(() => ({})),
  createSshClient: vi.fn(() => ({
    list: vi.fn(async () => []),
    listFiles: vi.fn(async () => []),
    mkdir: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    create: vi.fn(),
    update: vi.fn(),
  })),
}));

describe('useWorkspacePickerSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('默认打开本地来源，切到 SSH 后本地弹窗关闭、SSH 弹窗打开', () => {
    const { result } = renderHook(() =>
      useWorkspacePickerSources({
        gatewayUrl,
        token: 'token-1',
        onSelectLocal: vi.fn(),
        onSelectSsh: vi.fn(),
      }),
    );

    act(() => result.current.openLocal());
    expect(result.current.localPickerProps.isOpen).toBe(true);
    expect(result.current.sshPickerProps.isOpen).toBe(false);

    act(() => result.current.localPickerProps.onSwitchToSshSource?.());

    expect(result.current.sshPickerProps.isOpen).toBe(true);
    expect(result.current.localPickerProps.isOpen).toBe(false);
  });

  it('切到 SSH 来源时懒加载连接列表，关闭时来源复位', () => {
    const { result } = renderHook(() =>
      useWorkspacePickerSources({
        gatewayUrl,
        token: 'token-1',
        onSelectLocal: vi.fn(),
        onSelectSsh: vi.fn(),
      }),
    );

    act(() => result.current.openLocal('create'));
    expect(result.current.localPickerProps.initialCreateMode).toBe(true);

    act(() => result.current.switchToSsh());
    expect(result.current.sshPickerProps.isOpen).toBe(true);
    expect(result.current.localPickerProps.isOpen).toBe(false);

    act(() => result.current.close());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.source).toBe('local');
    expect(result.current.localPickerProps.initialCreateMode).toBe(false);
  });

  it('无token 时不请求 SSH 连接列表', () => {
    const { result } = renderHook(() =>
      useWorkspacePickerSources({
        gatewayUrl,
        token: null,
        onSelectLocal: vi.fn(),
        onSelectSsh: vi.fn(),
      }),
    );

    act(() => result.current.openSsh());

    expect(result.current.sshPickerProps.isOpen).toBe(true);
    expect(result.current.sshPickerProps.connections).toEqual([]);
  });

  it('把选中结果交给调用方的落地收口', async () => {
    const onSelectLocal = vi.fn();
    const onSelectSsh = vi.fn();
    const { result } = renderHook(() =>
      useWorkspacePickerSources({
        gatewayUrl,
        token: 'token-1',
        onSelectLocal,
        onSelectSsh,
      }),
    );

    act(() => result.current.openLocal());
    await act(async () => {
      await result.current.localPickerProps.onSelect('/home/await/project/OpenAWork');
    });
    expect(onSelectLocal).toHaveBeenCalledWith('/home/await/project/OpenAWork');

    act(() => result.current.openSsh());
    await act(async () => {
      await result.current.sshPickerProps.onSelect({ connectionId: 'ssh-1', path: '/srv/app' });
    });
    expect(onSelectSsh).toHaveBeenCalledWith({ connectionId: 'ssh-1', path: '/srv/app' });
  });
});
