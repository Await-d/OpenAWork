import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@openAwork/shared-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openAwork/shared-ui')>()),
  ToolKindIcon: () => <span />,
}));

afterEach(cleanup);
import {
  orderSubagentSessions,
  SubagentLoadMore,
  SubagentProgressProvider,
} from './subagent-progress.js';
import { FusionSubAgentSwitcher } from '../../pages/chat-page/panels/FusionSubAgentSwitcher.js';
import {
  SubAgentRunList,
  type SubAgentRunItem,
} from '../../pages/chat-page/panels/sub-agent-run-list.js';
import { TaskToolInline } from './tool-call/display/task-tool-inline.js';
import { ChatMessageGroupList, type ChatRenderGroup } from './message/chat-message-group-list.js';

const items: SubAgentRunItem[] = Array.from({ length: 12 }, (_, index) => ({
  sessionId: `child-${index}`,
  createdAt: index,
  shortSessionId: `child-${index}`,
  title: `任务${index}`,
  taskLabel: `任务${index}`,
  status: 'completed',
  messageCount: 0,
}));

describe('子代理渐进挂载', () => {
  it('按创建时间降序去重，恢复任务与输入顺序不改变原子会话顺序', () => {
    const source = [
      { sessionId: 'old', createdAt: 1 },
      { sessionId: 'new', createdAt: 3 },
      { sessionId: 'old', createdAt: 99 },
      { sessionId: 'tie-b', createdAt: 3 },
      { sessionId: 'tie-a', createdAt: 3 },
      { sessionId: 'missing' },
    ];
    const expected = ['new', 'tie-a', 'tie-b', 'old', 'missing'];
    expect(orderSubagentSessions(source)).toEqual(expected);
    expect(orderSubagentSessions([...source].reverse())).toEqual(expected);
  });

  it('正文卡片和侧栏同步 5→10→12，保留完整输入，切父会话恢复 5 个', () => {
    function View({ parent }: { parent: string }) {
      return (
        <SubagentProgressProvider parentSessionId={parent} sessions={items}>
          <FusionSubAgentSwitcher
            items={items}
            onSelectSession={vi.fn()}
            selectedSessionId={null}
          />
          {items.map((item) => (
            <TaskToolInline
              key={item.sessionId}
              toolName="task"
              input={{ description: item.title }}
              output={{ sessionId: item.sessionId }}
            />
          ))}
        </SubagentProgressProvider>
      );
    }
    const view = render(<View parent="a" />);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(view.container.querySelectorAll('[data-chat-task-inline]')).toHaveLength(5);
    expect(screen.queryByRole('tab', { name: /任务0 / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /加载更多子代理/ }));
    expect(screen.getAllByRole('tab')).toHaveLength(10);
    expect(view.container.querySelectorAll('[data-chat-task-inline]')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: /加载更多子代理/ }));
    expect(screen.getAllByRole('tab')).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /加载更多子代理/ })).toBeNull();
    expect(items).toHaveLength(12);
    view.rerender(<View parent="b" />);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });

  it('浮动列表仅挂载最新 5 个子会话，后台命令不占名额', () => {
    const view = render(
      <SubAgentRunList
        items={items}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={Array.from({ length: 7 }, (_, index) => ({
          key: `shell-${index}`,
          kind: 'shell',
          state: 'running',
          title: `命令${index}`,
          terminalId: `terminal-${index}`,
          startedAtMs: index,
        }))}
      />,
    );
    expect(view.container.querySelectorAll('.sub-agent-run-item__select')).toHaveLength(5);
    expect(
      view.container.querySelectorAll('[data-testid="sub-agent-run-list-shell-item"]'),
    ).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: /加载更多子代理/ }));
    expect(view.container.querySelectorAll('.sub-agent-run-item__select')).toHaveLength(10);
  });

  it('通知挂载前过滤且普通消息与 cron 通知保留，同一子会话的重复通知不多占名额', () => {
    const groups: ChatRenderGroup[] = items.map((item) => ({
      kind: 'subagent-notice',
      key: item.sessionId,
      createdAt: 1000 - (item.createdAt ?? 0),
      notice: {
        id: item.sessionId,
        source: 'subagent',
        agent: '代理',
        state: 'done',
        description: item.title,
        targetSessionId: item.sessionId,
        text: '结果',
        createdAt: 1000,
      },
    }));
    groups.push({
      kind: 'messages',
      key: 'ordinary',
      role: 'user',
      entries: [
        {
          message: { id: 'user', role: 'user', content: '普通消息' },
          renderContent: () => <span>普通消息</span>,
        },
      ],
    });
    groups.push({
      kind: 'subagent-notice',
      key: 'cron',
      createdAt: 2000,
      notice: {
        id: 'cron',
        source: 'cron',
        agent: '定时',
        state: 'done',
        description: '定时结果',
        targetSessionId: 'unrelated',
        text: '定时正文',
        createdAt: 2000,
      },
    });
    const view = render(
      <SubagentProgressProvider sessions={items}>
        <SubagentLoadMore />
        <ChatMessageGroupList
          groups={groups}
          activeModelId="m"
          activeProviderId="p"
          currentUserEmail="user@test"
          bottomRef={{ current: null }}
          scrollRegionRef={{ current: null }}
        />
      </SubagentProgressProvider>,
    );
    expect(
      view.container.querySelectorAll('[data-role="synthetic"][data-chat-group-root]'),
    ).toHaveLength(6);
    expect(screen.getByText('普通消息')).toBeTruthy();
    expect(view.container.querySelector('[data-group-key="cron"]')).toBeTruthy();
    expect(view.container.querySelector('[data-group-key="child-0"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /加载更多子代理/ }));
    expect(
      view.container.querySelectorAll('[data-role="synthetic"][data-chat-group-root]'),
    ).toHaveLength(11);
    expect(groups).toHaveLength(14);
  });
});
