// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopControlStatus } from '@openAwork/web-client';
import { SystemDesktopControlCard } from './system-desktop-control-card.js';

const BASE_SOURCE_STATE = {
  label: '系统桌面控制',
  endpoint: '/desktop-control/status',
  status: 'healthy',
  detail: 'bridge connected',
  error: null,
  count: null,
  updatedAt: 0,
} as const;

function renderCard(input: {
  readonly desktopControlEnabled: boolean;
  readonly desktopControlStatus: DesktopControlStatus | null;
}): void {
  render(
    <SystemDesktopControlCard
      desktopControlEnabled={input.desktopControlEnabled}
      desktopControlStatus={input.desktopControlStatus}
      desktopControlSourceState={BASE_SOURCE_STATE}
      onDesktopControlScreenshot={vi.fn(async () => ({ ok: true }))}
      onDesktopControlClick={vi.fn(async () => ({ ok: true }))}
      onDesktopControlType={vi.fn(async () => ({ ok: true }))}
      onDesktopControlKey={vi.fn(async () => ({ ok: true }))}
      onDesktopControlHotkey={vi.fn(async () => ({ ok: true }))}
      onDesktopControlScroll={vi.fn(async () => ({ ok: true }))}
      onDesktopControlWait={vi.fn(async () => ({ ok: true }))}
    />,
  );
}

describe('SystemDesktopControlCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('Given Linux 仅部分驱动可用 When 渲染卡片 Then 显示部分可用并禁用不支持动作', () => {
    renderCard({
      desktopControlEnabled: true,
      desktopControlStatus: {
        enabled: true,
        reason: 'desktop control bridge is running with limited native drivers',
        capabilities: {
          screenshot: { available: true, driver: 'grim' },
          click: {
            available: false,
            reason: 'xdotool not found; install xdotool and run under an X11 session',
          },
          typeText: {
            available: false,
            reason: 'xdotool not found; install xdotool and run under an X11 session',
          },
          key: {
            available: false,
            reason: 'xdotool not found; install xdotool and run under an X11 session',
          },
          hotkey: {
            available: false,
            reason: 'xdotool not found; install xdotool and run under an X11 session',
          },
          scroll: {
            available: false,
            reason: 'xdotool not found; install xdotool and run under an X11 session',
          },
          wait: { available: true, driver: 'native-wait' },
        },
      },
    });

    expect(screen.getByText(/系统桥接已连接（部分可用）/)).toBeTruthy();
    expect(screen.getByText('可用动作：2 / 7')).toBeTruthy();
    expect(screen.getByText('系统桥接已连接，但当前系统会话只开放了部分原生驱动。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '点击' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '输入' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '按键' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '组合键' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '滚动' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '等待' }).hasAttribute('disabled')).toBe(false);
  });

  it('Given Wayland session When 渲染卡片 Then 明确提示需要 X11 + xdotool', () => {
    renderCard({
      desktopControlEnabled: true,
      desktopControlStatus: {
        enabled: true,
        reason: 'Wayland session detected; input control requires xdotool and an X11 session',
        capabilities: {
          screenshot: { available: true, driver: 'grim' },
          click: {
            available: false,
            reason: 'Wayland session detected; input control requires xdotool and an X11 session',
          },
          typeText: {
            available: false,
            reason: 'Wayland session detected; input control requires xdotool and an X11 session',
          },
          key: {
            available: false,
            reason: 'Wayland session detected; input control requires xdotool and an X11 session',
          },
          hotkey: {
            available: false,
            reason: 'Wayland session detected; input control requires xdotool and an X11 session',
          },
          scroll: {
            available: false,
            reason: 'Wayland session detected; input control requires xdotool and an X11 session',
          },
          wait: { available: true, driver: 'native-wait' },
        },
      },
    });

    expect(screen.getByText(/系统桥接已连接（Wayland 限制）/)).toBeTruthy();
    expect(
      screen.getByText(
        '当前是 Wayland 会话，输入/点击/滚动控制需要 X11 + xdotool；现在通常只剩截图可用。',
      ),
    ).toBeTruthy();
  });

  it('Given 当前系统完全不支持桌面控制 When 渲染卡片 Then 展示不可用原因并隐藏控制台', () => {
    renderCard({
      desktopControlEnabled: true,
      desktopControlStatus: {
        enabled: false,
        reason: 'desktop control is not supported on this operating system',
      },
    });

    expect(screen.getByText(/系统桥接不可用/)).toBeTruthy();
    expect(screen.getByText('当前操作系统暂不支持系统桌面控制。')).toBeTruthy();
    expect(screen.queryByText('操作控制台')).toBeNull();
  });
});
