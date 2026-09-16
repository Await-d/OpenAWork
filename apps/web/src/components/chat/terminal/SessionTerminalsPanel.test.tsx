// @vitest-environment jsdom
/**
 * Smoke coverage for the chat-page session terminals panel.
 *
 * We verify three contract points:
 *
 *   1. Active rows (status='running') render a 终止 button; closed rows do not.
 *   2. Clicking 终止 invokes the kill handler with the right terminalId.
 *   3. Clicking 详情 expands the inline output preview so the user can
 *      eyeball stdout/stderr without leaving the chat.
 *
 * The panel itself is presentational (state is owned by useSessionTerminals
 * via ChatPage), so we render with hand-crafted props to keep the test
 * focused on UI behaviour.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { SessionTerminalsPanel, computeTerminalChipPosition } from './SessionTerminalsPanel.js';

// xterm.js relies on browser-only APIs (matchMedia, canvas) that jsdom
// doesn't fully provide. Stub the interactive view with a placeholder so
// the smoke test stays focused on the panel chrome.
vi.mock('./InteractiveTerminalView.js', () => ({
  InteractiveTerminalView: (props: { terminal: { outputTail: string } }) => (
    <div data-testid="terminal-view-mock">{props.terminal.outputTail}</div>
  ),
}));

function makeTerminal(overrides: Partial<SessionTerminalView>): SessionTerminalView {
  return {
    terminalId: 'term_default',
    sessionId: 'session-1',
    toolName: 'bash',
    kind: 'foreground',
    command: 'echo hi',
    cwd: '/tmp',
    status: 'running',
    startedAtMs: 1_700_000_000_000,
    lastActivityMs: 1_700_000_000_500,
    outputBytesTotal: 0,
    outputTail: '',
    ...overrides,
  };
}

const baseProps = {
  open: true,
  onClose: () => {},
  loading: false,
  error: null,
  pendingKillIds: new Set<string>(),
  onReload: () => {},
  gatewayUrl: 'https://gateway.test',
  token: 'test-token',
  sessionId: 'session-1',
};

describe('SessionTerminalsPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders 终止 button for running terminals only', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={[
          makeTerminal({ terminalId: 'term_running', status: 'running' }),
          makeTerminal({
            terminalId: 'term_done',
            status: 'exited',
            exitCode: 0,
            command: 'echo done',
          }),
        ]}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    const killButtons = screen.queryAllByRole('button', { name: '终止' });
    expect(killButtons.length).toBe(1);

    // Closed rows expose 清理 (delete) instead of 终止.
    const cleanupButtons = screen.queryAllByRole('button', { name: '清理' });
    expect(cleanupButtons.length).toBe(1);
  });

  it('clicking 终止 calls onKillTerminal with the right terminalId', () => {
    const onKill = vi.fn(async () => {});
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={[makeTerminal({ terminalId: 'term_kill_me', status: 'running' })]}
        onKillTerminal={onKill}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '终止' }));
    expect(onKill).toHaveBeenCalledWith('term_kill_me');
  });

  it('terminating button is disabled while a kill is in flight', () => {
    const pending = new Set<string>(['term_kill_me']);
    render(
      <SessionTerminalsPanel
        {...baseProps}
        pendingKillIds={pending}
        terminals={[makeTerminal({ terminalId: 'term_kill_me', status: 'running' })]}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );
    const button = screen.getByRole('button', { name: '终止中…' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('clicking 详情 expands the output preview', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={[
          makeTerminal({
            terminalId: 'term_with_output',
            status: 'exited',
            exitCode: 0,
            outputTail: 'first stdout line\nsecond line',
            outputBytesTotal: 32,
          }),
        ]}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByText(/first stdout line/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.getByText(/first stdout line/)).toBeTruthy();
  });

  it('renders empty-state copy when there are no terminals', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={[]}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByText(/还没有跑过终端命令/)).toBeTruthy();
  });
});

/**
 * 筛选 / 批量处置覆盖。
 *
 * 会话终端多起来之后（一个长会话几十条记录），逐行点终止或清理是不现实
 * 的。这里锁定两件事：筛选能收敛列表，批量按钮能一次命中所有目标。
 */
const twoRunningAndOneClosed = [
  makeTerminal({ terminalId: 'term_dev', status: 'running', command: 'npm run dev' }),
  makeTerminal({ terminalId: 'term_test', status: 'running', command: 'vitest run' }),
  makeTerminal({
    terminalId: 'term_done',
    status: 'exited',
    command: 'pnpm build',
    exitCode: 0,
  }),
];

describe('SessionTerminalsPanel 筛选与批量', () => {
  afterEach(() => {
    cleanup();
  });

  it('按状态筛选后只保留对应行', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryAllByRole('button', { name: '终止' }).length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: '运行中 2' }));

    expect(screen.queryAllByRole('button', { name: '终止' }).length).toBe(2);
    expect(screen.queryByRole('button', { name: '清理' })).toBeNull();
  });

  it('按命令关键字过滤', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    fireEvent.change(screen.getByLabelText('按命令或目录过滤终端'), {
      target: { value: 'vitest' },
    });

    expect(screen.getByText('vitest run')).toBeTruthy();
    expect(screen.queryByText('npm run dev')).toBeNull();
    expect(screen.queryAllByRole('button', { name: '终止' }).length).toBe(1);
  });

  it('无匹配时给出清除筛选入口', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    fireEvent.change(screen.getByLabelText('按命令或目录过滤终端'), {
      target: { value: 'no-such-command' },
    });
    expect(screen.getByText('没有符合当前筛选条件的终端。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByText('npm run dev')).toBeTruthy();
  });

  it('批量终止会对每个运行中终端各调用一次', async () => {
    const onKill = vi.fn(async () => {});
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={onKill}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /终止全部运行中/ }));

    await waitFor(() => expect(onKill).toHaveBeenCalledTimes(2));
    expect(onKill).toHaveBeenCalledWith('term_dev');
    expect(onKill).toHaveBeenCalledWith('term_test');
  });

  it('筛选后批量按钮只作用于可见行', async () => {
    const onKill = vi.fn(async () => {});
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={onKill}
      />,
    );

    fireEvent.change(screen.getByLabelText('按命令或目录过滤终端'), {
      target: { value: 'npm run dev' },
    });
    fireEvent.click(screen.getByRole('button', { name: /终止全部运行中/ }));

    await waitFor(() => expect(onKill).toHaveBeenCalledTimes(1));
    expect(onKill).toHaveBeenCalledWith('term_dev');
  });

  it('展示同步状态文案', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        lastSyncedAtMs={Date.now()}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText('刚刚同步')).toBeTruthy();
  });
});

describe('computeTerminalChipPosition', () => {
  it('375px 下左边界不越界（T-13 / D-4 回归：旧实现给出 -232）', () => {
    const position = computeTerminalChipPosition({
      anchorRect: { left: 79, right: 111, top: 113, bottom: 137 },
      viewportWidth: 375,
      viewportHeight: 720,
      popoverWidth: 343,
      popoverHeight: 175,
    });

    expect(position.left).toBe(24);
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.top).toBe(143);
  });

  it('宽视口下右边缘对齐锚点右边缘并贴锚点下方', () => {
    const position = computeTerminalChipPosition({
      anchorRect: { left: 1160, right: 1200, top: 40, bottom: 64 },
      viewportWidth: 1280,
      viewportHeight: 800,
      popoverWidth: 343,
      popoverHeight: 175,
    });

    expect(position.left).toBe(857);
    expect(position.top).toBe(70);
  });

  it('下方空间不足时翻转到锚点上方', () => {
    const position = computeTerminalChipPosition({
      anchorRect: { left: 1000, right: 1040, top: 600, bottom: 624 },
      viewportWidth: 1280,
      viewportHeight: 720,
      popoverWidth: 343,
      popoverHeight: 175,
    });

    expect(position.top).toBe(419);
  });

  it('上下都放不下时夹取到视口上边距', () => {
    const position = computeTerminalChipPosition({
      anchorRect: { left: 79, right: 111, top: 10, bottom: 34 },
      viewportWidth: 375,
      viewportHeight: 720,
      popoverWidth: 343,
      popoverHeight: 700,
    });

    expect(position.top).toBe(8);
  });

  it('自定义 margin 同时约束水平夹取的下界', () => {
    const position = computeTerminalChipPosition({
      anchorRect: { left: 0, right: 111, top: 100, bottom: 124 },
      viewportWidth: 375,
      viewportHeight: 720,
      popoverWidth: 343,
      popoverHeight: 175,
      margin: 40,
    });

    expect(position.left).toBe(40);
  });

  it('多视口 / 多锚点扫描：popover 始终留在视口内', () => {
    for (const viewportWidth of [320, 375, 430, 768, 1024, 1280, 1920]) {
      const popoverWidth = Math.min(343, viewportWidth - 16);
      for (const anchorRight of [40, 111, viewportWidth / 2, viewportWidth - 8]) {
        const position = computeTerminalChipPosition({
          anchorRect: { left: anchorRight - 32, right: anchorRight, top: 113, bottom: 137 },
          viewportWidth,
          viewportHeight: 720,
          popoverWidth,
          popoverHeight: 175,
        });

        expect(position.left).toBeGreaterThanOrEqual(8);
        expect(position.left + popoverWidth).toBeLessThanOrEqual(viewportWidth - 8);
        expect(position.top).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('恰好贴边：右对齐刚好落在左边界上（不触发左对齐回退，也不越界）', () => {
    const position = computeTerminalChipPosition({
      anchorRect: { left: 300, right: 351, top: 80, bottom: 106 },
      viewportWidth: 375,
      viewportHeight: 720,
      popoverWidth: 343,
      popoverHeight: 175,
    });

    expect(position.left).toBe(8);
    expect(position.left + 343).toBe(351);
  });

  it('锚点在中间且右侧放得下时保持右边缘对齐', () => {
    const position = computeTerminalChipPosition({
      anchorRect: { left: 600, right: 700, top: 40, bottom: 66 },
      viewportWidth: 1280,
      viewportHeight: 800,
      popoverWidth: 520,
      popoverHeight: 400,
    });

    expect(position.left).toBe(180);
    expect(position.left + 520).toBe(700);
  });

  it('锚点靠左且 popover 比锚点宽时左对齐回退后夹取到右边界（不越出左侧）', () => {
    const position = computeTerminalChipPosition({
      anchorRect: { left: 96, right: 128, top: 80, bottom: 106 },
      viewportWidth: 375,
      viewportHeight: 720,
      popoverWidth: 343,
      popoverHeight: 175,
    });

    // 左对齐锚点(96) 仍越出右边界 → 夹到 maxLeft = 375 - 343 - 8 = 24。
    expect(position.left).toBe(24);
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.left + 343).toBe(367);
  });

  it('首帧尺寸未知（0×0）时不产生 NaN，且仍在视口内', () => {
    const position = computeTerminalChipPosition({
      anchorRect: { left: 40, right: 111, top: 80, bottom: 106 },
      viewportWidth: 375,
      viewportHeight: 720,
      popoverWidth: 0,
      popoverHeight: 0,
    });

    expect(Number.isFinite(position.left)).toBe(true);
    expect(Number.isFinite(position.top)).toBe(true);
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.top).toBeGreaterThanOrEqual(8);
  });
});

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * 组件级回归：T-13 / D-4 的 375px 越界必须由「portal + 实测尺寸 + 双向夹取」共同堵住。
 * jsdom 没有真实布局，所以这里打桩 getBoundingClientRect 提供实测值。
 */
describe('SessionTerminalsPanel popover 定位（375 回归）', () => {
  afterEach(() => {
    cleanup();
  });

  it('375px 下弹层 portal 到 body 且完整落在视口内', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    const originalRect = Element.prototype.getBoundingClientRect;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      if (
        this.getAttribute('role') === 'dialog' &&
        this.getAttribute('aria-label') === '会话终端'
      ) {
        return makeRect(0, 0, 343, 175);
      }
      return originalRect.call(this);
    };
    const anchorRef = {
      current: {
        getBoundingClientRect: () => makeRect(40, 80, 71, 26),
      } as unknown as HTMLElement,
    };

    try {
      render(
        <SessionTerminalsPanel
          {...baseProps}
          anchorRef={anchorRef}
          terminals={[makeTerminal({ terminalId: 'term_375' })]}
          onKillTerminal={vi.fn(async () => {})}
        />,
      );

      const dialog = screen.getByRole('dialog', { name: '会话终端' });
      // portal 到 body：否则 CachedRouteOutlet 的 contain 会把 fixed 包含块改成祖先。
      expect(dialog.parentElement).toBe(document.body);

      const left = Number.parseFloat(dialog.style.left);
      const top = Number.parseFloat(dialog.style.top);
      expect(left).toBe(24);
      expect(top).toBe(112);
      expect(left + 343).toBeLessThanOrEqual(375 - 8);
      expect(top + 175).toBeLessThanOrEqual(720 - 8);
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    }
  });
});
