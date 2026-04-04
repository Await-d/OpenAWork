import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Session, SessionTask } from '@openAwork/web-client';
import { buildSubAgentRunItems, SubAgentRunList } from './sub-agent-run-list.js';

function createSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? 'child-1',
    state_status: overrides.state_status ?? 'idle',
    title: overrides.title,
    messages: overrides.messages,
    metadata_json: overrides.metadata_json,
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
  };
}

function createSessionTask(overrides: Partial<SessionTask>): SessionTask {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? '子代理任务',
    description: overrides.description,
    status: overrides.status ?? 'pending',
    blockedBy: overrides.blockedBy ?? [],
    completedSubtaskCount: overrides.completedSubtaskCount ?? 0,
    parentTaskId: overrides.parentTaskId,
    readySubtaskCount: overrides.readySubtaskCount ?? 0,
    sessionId: overrides.sessionId,
    assignedAgent: overrides.assignedAgent,
    priority: overrides.priority ?? 'medium',
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    startedAt: overrides.startedAt,
    completedAt: overrides.completedAt,
    depth: overrides.depth ?? 0,
    subtaskCount: overrides.subtaskCount ?? 0,
    unmetDependencyCount: overrides.unmetDependencyCount ?? 0,
    result: overrides.result,
    errorMessage: overrides.errorMessage,
    terminalReason: overrides.terminalReason,
  };
}

function renderStatuses(items: ReturnType<typeof buildSubAgentRunItems>): string {
  return renderToStaticMarkup(
    <SubAgentRunList items={items} onSelectSession={() => undefined} selectedSessionId={null} />,
  );
}

describe('sub-agent-run-list', () => {
  it('shows paused child sessions as waiting even when the task is still running', () => {
    const items = buildSubAgentRunItems(
      [createSession({ id: 'child-1', title: 'MCP 文档检索', state_status: 'paused' })],
      [
        createSessionTask({
          id: 'task-1',
          title: 'MCP 文档检索',
          status: 'running',
          sessionId: 'child-1',
          assignedAgent: 'librarian',
        }),
      ],
    );

    expect(items[0]?.status).toBe('paused');
    expect(renderStatuses(items)).toContain('等待处理');
  });

  it('keeps terminal task states visible even if the child session remains paused', () => {
    const items = buildSubAgentRunItems(
      [createSession({ id: 'child-1', title: 'MCP 文档检索', state_status: 'paused' })],
      [
        createSessionTask({
          id: 'task-1',
          title: 'MCP 文档检索',
          status: 'completed',
          sessionId: 'child-1',
          result: '文档摘要已生成。',
        }),
      ],
    );

    expect(items[0]?.status).toBe('completed');
    expect(renderStatuses(items)).toContain('已完成');
  });

  it('shows paused child sessions without task projection as waiting', () => {
    const items = buildSubAgentRunItems(
      [createSession({ id: 'child-1', title: 'MCP 文档检索', state_status: 'paused' })],
      [],
    );

    expect(items[0]?.status).toBe('paused');
    expect(renderStatuses(items)).toContain('等待处理');
  });

  it('uses a tighter vertical layout to keep the run cards compact above the composer', () => {
    const html = renderStatuses(
      buildSubAgentRunItems(
        [createSession({ id: 'child-1', title: 'MCP 文档检索', state_status: 'running' })],
        [
          createSessionTask({
            id: 'task-1',
            title: 'MCP 文档检索',
            status: 'running',
            sessionId: 'child-1',
            assignedAgent: 'librarian',
          }),
        ],
      ),
    );

    expect(html).toContain('padding:1px 10px 4px');
    expect(html).toContain('padding:6px 8px');
    expect(html).toContain('font-size:10px');
    expect(html).toContain('padding:1px 5px');
    expect(html).toContain('Alt↑↓');
  });

  it('collapses duplicated task labels into the metadata row for an ultra-compact card', () => {
    const html = renderStatuses(
      buildSubAgentRunItems(
        [createSession({ id: 'child-1', title: 'MCP 文档检索', state_status: 'running' })],
        [
          createSessionTask({
            id: 'task-1',
            title: 'MCP 文档检索',
            status: 'running',
            sessionId: 'child-1',
          }),
        ],
      ),
    );

    expect(html).toContain('会话 · child-1');
    expect(html).not.toContain('会话 · child-1 · MCP 文档检索');
  });

  it('surfaces timeout terminal reasons when no explicit error or result exists', () => {
    const html = renderStatuses(
      buildSubAgentRunItems(
        [createSession({ id: 'child-timeout-1', title: '超时子代理', state_status: 'idle' })],
        [
          createSessionTask({
            id: 'task-timeout-1',
            title: '超时子代理',
            status: 'failed',
            sessionId: 'child-timeout-1',
            terminalReason: 'timeout',
          }),
        ],
      ),
    );

    expect(html).toContain('子代理执行超时');
  });
});
