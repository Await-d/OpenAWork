/**
 * 模式提示词覆盖 hook 的并发门控回归（复查 V-10）。
 *
 * 场景：保存请求在途时发生重新加载（切换网关 / 账号），旧响应晚到 ——
 * 它不得写回，否则会把上一个账号的覆盖混进当前账号的视图状态。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DialogueModePromptView } from '@openAwork/web-client';
import { useDialogueModePromptOverrides } from './use-dialogue-mode-prompt-overrides.js';

const clientMock = vi.hoisted(() => ({
  read: vi.fn(),
  writeDialogueMode: vi.fn(),
  resetDialogueMode: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createPromptOverridesClient: () => clientMock,
}));

function snapshot(marker: string) {
  return {
    modes: [
      {
        mode: 'clarify',
        defaultText: 'D-clarify',
        effectiveText: `${marker}-clarify`,
        hasOverride: marker !== 'D',
      },
      {
        mode: 'coding',
        defaultText: 'D-coding',
        effectiveText: `${marker}-coding`,
        hasOverride: marker !== 'D',
      },
      {
        mode: 'programmer',
        defaultText: 'D-programmer',
        effectiveText: `${marker}-programmer`,
        hasOverride: marker !== 'D',
      },
    ],
    maxChars: 32768,
    configState: 'ok' as const,
  };
}

beforeEach(() => {
  clientMock.read.mockReset();
  clientMock.writeDialogueMode.mockReset();
  clientMock.resetDialogueMode.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDialogueModePromptOverrides', () => {
  it('加载后暴露三种模式的有效值与上限', async () => {
    clientMock.read.mockResolvedValue(snapshot('A'));

    const { result } = renderHook(() =>
      useDialogueModePromptOverrides({ active: true, gatewayUrl: 'http://gw', token: 'token-a' }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.modes).toHaveLength(3);
    expect(result.current.modes[0]?.effectiveText).toBe('A-clarify');
    expect(result.current.maxChars).toBe(32768);
  });

  it('在途保存的响应若在重新加载之后到达，不得写回（防跨账号污染）', async () => {
    clientMock.read.mockResolvedValueOnce(snapshot('A'));

    let resolveWrite: (view: DialogueModePromptView) => void = () => {
      /* 由测试在适当时机替换 */
    };
    clientMock.writeDialogueMode.mockReturnValue(
      new Promise<DialogueModePromptView>((resolve) => {
        resolveWrite = resolve;
      }),
    );

    const { result, rerender } = renderHook(
      ({ token }: { token: string }) =>
        useDialogueModePromptOverrides({ active: true, gatewayUrl: 'http://gw', token }),
      { initialProps: { token: 'token-a' } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.modes[1]?.effectiveText).toBe('A-coding');

    let savePromise: Promise<boolean> | undefined;
    act(() => {
      savePromise = result.current.save('coding', '账号 A 的覆盖');
    });

    // 期间切换账号 → 触发 reload（revision 自增），并返回账号 B 的快照
    clientMock.read.mockResolvedValue(snapshot('B'));
    rerender({ token: 'token-b' });
    await waitFor(() => expect(result.current.modes[1]?.effectiveText).toBe('B-coding'));

    // 旧保存的响应此刻才到
    await act(async () => {
      resolveWrite({
        mode: 'coding',
        defaultText: 'D-coding',
        effectiveText: '账号 A 的覆盖',
        hasOverride: true,
      });
      await savePromise;
    });

    // 不得被旧账号的响应污染
    expect(result.current.modes[1]?.effectiveText).toBe('B-coding');
  });

  it('未发生重新加载时保存成功会写回视图', async () => {
    clientMock.read.mockResolvedValue(snapshot('A'));
    clientMock.writeDialogueMode.mockResolvedValue({
      mode: 'coding',
      defaultText: 'D-coding',
      effectiveText: '新覆盖',
      hasOverride: true,
    });

    const { result } = renderHook(() =>
      useDialogueModePromptOverrides({ active: true, gatewayUrl: 'http://gw', token: 'token-a' }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.save('coding', '新覆盖');
    });

    expect(result.current.modes[1]?.effectiveText).toBe('新覆盖');
    expect(result.current.modes[1]?.hasOverride).toBe(true);
    expect(result.current.feedback).toBe('已保存模式提示词');
  });
});
