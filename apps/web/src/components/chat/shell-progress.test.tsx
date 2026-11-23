import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubagentProgressProvider } from './subagent-progress.js';
import { ShellProgressProvider, shellToolTerminalId } from './shell-progress.js';
import { ToolCallDisplay } from './tool-call/display/tool-call-display.js';
import {
  SubAgentRunList,
  type SubAgentRunItem,
} from '../../pages/chat-page/panels/sub-agent-run-list.js';
import { BackgroundTaskPanel } from '../../pages/chat-page/panels/background-task-panel.js';
import type { BackgroundTaskRow } from '../../pages/chat-page/panels/background-task-model.js';

vi.mock('@openAwork/shared-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openAwork/shared-ui')>()),
  ToolKindIcon: () => <span />,
}));
afterEach(cleanup);

const shells: BackgroundTaskRow[] = Array.from({ length: 12 }, (_, index) => ({
  key: `term-${index}`,
  terminalId: `term-${index}`,
  kind: 'shell',
  state: index === 0 ? 'running' : 'succeeded',
  title: `命令${index}`,
  command: `echo command-${index}`,
  startedAtMs: index,
}));
const agents: SubAgentRunItem[] = shells.map((row, index) => ({
  sessionId: row.key,
  createdAt: index,
  shortSessionId: row.key,
  title: `代理${index}`,
  taskLabel: `代理${index}`,
  status: 'completed',
  messageCount: 0,
}));

function View({ parent = 'a', rows = shells }: { parent?: string; rows?: BackgroundTaskRow[] }) {
  return (
    <SubagentProgressProvider
      parentSessionId={parent}
      sessions={agents}
      shells={rows.map((row) => ({ terminalId: row.key, startedAtMs: row.startedAtMs }))}
    >
      <div data-testid="main">
        <SubAgentRunList
          items={agents}
          sessionId={parent}
          shellItems={rows}
          onSelectSession={vi.fn()}
          selectedSessionId={null}
        />
      </div>
      <div data-testid="side">
        <BackgroundTaskPanel
          model={{
            rows,
            now: 100,
            summary: { runningSubagents: 0, runningShells: 1, activeTotal: 1 },
          }}
          loading={false}
          error={null}
          lastSyncedAtMs={100}
          stoppingSubAgentIds={new Set()}
          pendingKillIds={new Set()}
          onReloadTerminals={vi.fn()}
          onOpenSession={vi.fn()}
          onStopSubagent={vi.fn()}
          onStopAllSubagents={vi.fn()}
          onPreviewTerminal={vi.fn()}
          onKillTerminal={vi.fn()}
        />
      </div>
      <div data-testid="tools">
        {rows.map((row) => (
          <ToolCallDisplay
            key={row.key}
            toolName="run_bash_in_background"
            input={{ command: row.command }}
            output={{ terminalId: row.key }}
            status="completed"
          />
        ))}
        <ToolCallDisplay
          toolName="bash"
          input={{ command: 'echo foreground' }}
          output={{ terminalId: 'foreground', output: 'foreground-output' }}
          status="completed"
        />
      </div>
    </SubagentProgressProvider>
  );
}

describe('后台命令渐进挂载', () => {
  it('识别后台终端输出与读取/终止入参，普通工具的同名字段不参与分页', () => {
    expect(shellToolTerminalId('run_bash_in_background', {}, '{"terminalId":"t"}')).toBe('t');
    expect(shellToolTerminalId('bash_output', { terminal_id: 't' }, undefined)).toBe('t');
    expect(shellToolTerminalId('bash_kill', { terminal_id: 't' }, undefined)).toBe('t');
    expect(shellToolTerminalId('bash_output', { terminal_id: 't' }, 'plain output')).toBe('t');
    expect(shellToolTerminalId('bash_kill', { terminal_id: 't' }, '"stopped"')).toBe('t');
    expect(shellToolTerminalId('bash_output', { terminal_id: 't' }, { terminalId: '' })).toBe('t');
    expect(shellToolTerminalId('read', {}, { terminalId: 't' })).toBeNull();
    expect(shellToolTerminalId('bash', {}, 'ordinary output')).toBeNull();
  });

  it('隐藏旧终端的工具结果时保留权限审批卡及前台 bash', () => {
    render(
      <ShellProgressProvider
        shells={shells.map((row) => ({ terminalId: row.key, startedAtMs: row.startedAtMs }))}
      >
        <ToolCallDisplay
          toolName="bash_output"
          input={{ terminal_id: 'term-0' }}
          output="hidden-old-output"
          status="completed"
        />
        <ToolCallDisplay
          toolName="bash_kill"
          input={{ terminal_id: 'term-0' }}
          pendingPermissionRequestId="permission"
          status="paused"
        />
        <ToolCallDisplay
          toolName="bash"
          input={{ command: 'foreground-command' }}
          output="foreground-output"
          status="completed"
        />
      </ShellProgressProvider>,
    );
    expect(document.body.textContent).not.toContain('hidden-old-output');
    expect(document.body.textContent).not.toContain('bash_output');
    expect(document.body.textContent).toContain('bash_kill');
    expect(document.body.textContent).toContain('foreground-output');
  });
  it('主卡片、侧栏和内联工具同步 5→10→12，父会话切换重置；子代理独立', () => {
    const view = render(<View />);
    const main = within(screen.getByTestId('main'));
    const side = within(screen.getByTestId('side'));
    const shellCards = () => main.getAllByTestId('sub-agent-run-list-shell-item');
    expect(shellCards()).toHaveLength(5);
    expect(shellCards()[0]?.textContent).toContain('command-11');
    expect(side.queryByText('echo command-0')).toBeNull();
    expect(screen.getByTestId('tools').textContent).not.toContain('command-0');
    expect(screen.getByTestId('tools').textContent).toContain('foreground');
    expect(screen.getByTestId('main').querySelectorAll('.sub-agent-run-item__select')).toHaveLength(
      5,
    );
    fireEvent.click(main.getByRole('button', { name: /加载更多后台命令/ }));
    expect(shellCards()).toHaveLength(10);
    expect(side.getByRole('button', { name: /剩余 2 个/ })).toBeTruthy();
    expect(screen.getByTestId('main').querySelectorAll('.sub-agent-run-item__select')).toHaveLength(
      5,
    );
    fireEvent.click(main.getByRole('button', { name: /加载更多子代理/ }));
    expect(shellCards()).toHaveLength(10);
    expect(screen.getByTestId('main').querySelectorAll('.sub-agent-run-item__select')).toHaveLength(
      10,
    );
    fireEvent.click(side.getByRole('button', { name: /加载更多后台命令/ }));
    expect(shellCards()).toHaveLength(12);
    expect(main.queryByRole('button', { name: /加载更多后台命令/ })).toBeNull();
    expect(shells).toHaveLength(12);
    view.rerender(<View parent="b" />);
    expect(shellCards()).toHaveLength(5);
    expect(screen.getByTestId('main').querySelectorAll('.sub-agent-run-item__select')).toHaveLength(
      5,
    );
  });

  it('状态和输入顺序变化不改变真实启动顺序，新命令进入最新窗口', () => {
    const view = render(<View />);
    view.rerender(
      <View rows={[...shells].reverse().map((row) => ({ ...row, state: 'running' }))} />,
    );
    expect(screen.getAllByTestId('sub-agent-run-list-shell-item')[0]?.textContent).toContain(
      'command-11',
    );
    view.rerender(
      <View
        rows={[
          ...shells,
          {
            ...shells[0]!,
            key: 'new',
            terminalId: 'new',
            command: 'new-command',
            startedAtMs: 100,
          },
        ]}
      />,
    );
    expect(screen.getAllByTestId('sub-agent-run-list-shell-item')[0]?.textContent).toContain(
      'new-command',
    );
    expect(screen.getAllByTestId('sub-agent-run-list-shell-item')).toHaveLength(5);
  });
});
