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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionTerminalView } from '../session-conversation/runtime/terminals-api.js';
import { SessionTerminalsPanel } from './SessionTerminalsPanel.js';

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
