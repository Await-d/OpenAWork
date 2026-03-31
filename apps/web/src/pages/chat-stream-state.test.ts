import { describe, expect, it } from 'vitest';
import {
  applyChatRightPanelEvent,
  applyChatRightPanelChunk,
  createInitialChatRightPanelState,
  getToolCallCards,
  startChatRightPanelRun,
} from './chat-stream-state.js';

describe('chat-stream-state', () => {
  it('starts a run with an orchestrator node and agent_started event', () => {
    const state = startChatRightPanelRun(createInitialChatRightPanelState(), '搜索天气');

    expect(state.agentEvents).toHaveLength(1);
    expect(state.agentEvents[0]).toMatchObject({ type: 'agent_started' });
    expect(state.dagNodes).toHaveLength(1);
    expect(state.dagNodes[0]).toMatchObject({ type: 'orchestrator', status: 'running' });
  });

  it('creates plan/viz/dag/tool state from tool_call_delta', () => {
    const started = startChatRightPanelRun(createInitialChatRightPanelState(), '搜索天气');
    const state = applyChatRightPanelChunk(started, {
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '{"query":"上海天气"}',
    });

    expect(state.planTasks).toEqual([{ id: 'call_1', label: 'web_search', status: 'in_progress' }]);
    expect(state.toolCalls[0]).toMatchObject({
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputText: '{"query":"上海天气"}',
      status: 'running',
    });
    expect(state.agentEvents.some((event) => event.type === 'tool_call')).toBe(true);
    expect(state.dagNodes.some((node) => node.id === 'call_1' && node.type === 'tool')).toBe(true);
    expect(state.dagEdges.some((edge) => edge.target === 'call_1')).toBe(true);
  });

  it('merges repeated tool deltas without duplicating tasks or nodes', () => {
    const started = startChatRightPanelRun(createInitialChatRightPanelState(), '搜索天气');
    const state = applyChatRightPanelChunk(
      applyChatRightPanelChunk(started, {
        type: 'tool_call_delta',
        toolCallId: 'call_1',
        toolName: 'web_search',
        inputDelta: '{"query":"上海',
      }),
      {
        type: 'tool_call_delta',
        toolCallId: 'call_1',
        toolName: 'web_search',
        inputDelta: '天气"}',
      },
    );

    expect(state.planTasks).toHaveLength(1);
    expect(state.dagNodes.filter((node) => node.id === 'call_1')).toHaveLength(1);
    expect(state.toolCalls[0]?.inputText).toBe('{"query":"上海天气"}');
  });

  it('treats empty tool input as an empty object instead of a raw string wrapper', () => {
    const started = startChatRightPanelRun(createInitialChatRightPanelState(), '检查空工具参数');
    const state = applyChatRightPanelChunk(started, {
      type: 'tool_call_delta',
      toolCallId: 'call_empty',
      toolName: 'list',
      inputDelta: '',
    });

    expect(state.toolCalls[0]).toMatchObject({
      toolCallId: 'call_empty',
      input: {},
    });
  });

  it('marks tasks complete and snapshots plan history on done', () => {
    const started = startChatRightPanelRun(createInitialChatRightPanelState(), '搜索天气');
    const running = applyChatRightPanelChunk(started, {
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '{"query":"上海天气"}',
    });
    const done = applyChatRightPanelChunk(running, { type: 'done', stopReason: 'tool_use' });

    expect(done.planTasks[0]).toMatchObject({ status: 'done' });
    expect(done.toolCalls[0]).toMatchObject({ status: 'completed' });
    expect(done.agentEvents.some((event) => event.type === 'agent_done')).toBe(true);
    expect(done.planHistory[0]).toMatchObject({ status: 'completed' });
  });

  it('projects completed tool calls into ToolCallCard-friendly models', () => {
    const started = startChatRightPanelRun(createInitialChatRightPanelState(), '搜索天气');
    const running = applyChatRightPanelChunk(started, {
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '{"query":"上海天气"}',
    });
    const done = applyChatRightPanelChunk(running, { type: 'done', stopReason: 'tool_use' });

    expect(getToolCallCards(done)).toEqual([
      {
        toolCallId: 'call_1',
        toolName: 'web_search',
        input: { query: '上海天气' },
        output: undefined,
        isError: false,
        status: 'completed',
      },
    ]);
  });

  it('applies tool_result events to cards, tasks, and dag state', () => {
    const started = startChatRightPanelRun(createInitialChatRightPanelState(), '搜索天气');
    const running = applyChatRightPanelChunk(started, {
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      toolName: 'web_search',
      inputDelta: '{"query":"上海天气"}',
    });

    const state = applyChatRightPanelEvent(running, {
      type: 'tool_result',
      toolCallId: 'call_1',
      toolName: 'web_search',
      output: { city: '上海', weather: '晴' },
      isError: false,
      eventId: 'evt-tool-1',
      runId: 'run-tool-1',
      occurredAt: 123,
    });

    expect(state.toolCalls[0]).toMatchObject({
      toolCallId: 'call_1',
      status: 'completed',
      output: { city: '上海', weather: '晴' },
      isError: false,
    });
    expect(state.planTasks[0]).toMatchObject({ id: 'call_1', status: 'done' });
    expect(state.dagNodes.find((node) => node.id === 'call_1')).toMatchObject({
      status: 'completed',
    });
    expect(getToolCallCards(state)).toEqual([
      {
        toolCallId: 'call_1',
        toolName: 'web_search',
        input: { query: '上海天气' },
        output: { city: '上海', weather: '晴' },
        isError: false,
        status: 'completed',
      },
    ]);
    expect(state.agentEvents.some((event) => event.type === 'tool_done')).toBe(true);
  });

  it('treats pending-permission tool results as paused instead of failed', () => {
    const started = startChatRightPanelRun(createInitialChatRightPanelState(), '调用 task 工具');
    const running = applyChatRightPanelChunk(started, {
      type: 'tool_call_delta',
      toolCallId: 'call_perm',
      toolName: 'task',
      inputDelta: '{"prompt":"inspect workspace"}',
    });

    const state = applyChatRightPanelEvent(running, {
      type: 'tool_result',
      toolCallId: 'call_perm',
      toolName: 'task',
      output: 'waiting for approval',
      isError: false,
      pendingPermissionRequestId: 'perm-1',
      eventId: 'evt-tool-perm',
      runId: 'run-tool-perm',
      occurredAt: 456,
    });

    expect(state.toolCalls[0]).toMatchObject({
      toolCallId: 'call_perm',
      status: 'paused',
      isError: false,
      pendingPermissionRequestId: 'perm-1',
    });
    expect(state.planTasks[0]).toMatchObject({ id: 'call_perm', status: 'pending' });
    expect(state.dagNodes.find((node) => node.id === 'call_perm')).toMatchObject({
      status: 'pending',
    });
    expect(getToolCallCards(state)).toEqual([
      {
        toolCallId: 'call_perm',
        toolName: 'task',
        input: { prompt: 'inspect workspace' },
        output: 'waiting for approval',
        isError: false,
        status: 'paused',
      },
    ]);
  });

  it('records permission and child-session events instead of discarding them', () => {
    const withPermission = applyChatRightPanelEvent(createInitialChatRightPanelState(), {
      type: 'permission_asked',
      requestId: 'perm-1',
      toolName: 'bash',
      scope: 'workspace',
      reason: '需要运行命令',
      riskLevel: 'medium',
      previewAction: 'pnpm test',
      eventId: 'evt-perm-1',
      runId: 'run-perm-1',
      occurredAt: 123,
    });
    const withReply = applyChatRightPanelEvent(withPermission, {
      type: 'permission_replied',
      requestId: 'perm-1',
      decision: 'once',
      eventId: 'evt-perm-2',
      runId: 'run-perm-1',
      occurredAt: 124,
    });
    const withChild = applyChatRightPanelEvent(withReply, {
      type: 'session_child',
      sessionId: 'child-1',
      parentSessionId: 'session-1',
      title: '子任务会话',
      eventId: 'evt-child-1',
      runId: 'run-child-1',
      occurredAt: 125,
    });

    expect(withChild.agentEvents.map((event) => event.label)).toEqual([
      '等待权限：bash · pnpm test',
      '权限已响应：本次允许',
      '已创建子会话：子任务会话',
    ]);
  });

  it('records question asked and replied events for waiting states', () => {
    const withQuestion = applyChatRightPanelEvent(createInitialChatRightPanelState(), {
      type: 'question_asked',
      requestId: 'question-1',
      toolName: 'question',
      title: '请选择要查看的目录',
      eventId: 'evt-question-1',
      runId: 'run-question-1',
      occurredAt: 200,
    });
    const withAnswer = applyChatRightPanelEvent(withQuestion, {
      type: 'question_replied',
      requestId: 'question-1',
      status: 'answered',
      eventId: 'evt-question-2',
      runId: 'run-question-1',
      occurredAt: 201,
    });

    expect(withAnswer.agentEvents.map((event) => event.label)).toEqual([
      '等待回答：请选择要查看的目录',
      '问题已响应：已回答',
    ]);
  });

  it('records compaction events for overview/history rendering', () => {
    const state = applyChatRightPanelEvent(createInitialChatRightPanelState(), {
      type: 'compaction',
      summary: '保留最近 20 条消息，其余已压缩。',
      trigger: 'manual',
      eventId: 'evt-1',
      runId: 'run-1',
      occurredAt: 123,
    });

    expect(state.compactions).toEqual([
      {
        id: 'evt-1',
        summary: '保留最近 20 条消息，其余已压缩。',
        trigger: 'manual',
        occurredAt: 123,
      },
    ]);
  });

  it('records cancelled task updates distinctly from failed tasks', () => {
    const state = applyChatRightPanelEvent(createInitialChatRightPanelState(), {
      type: 'task_update',
      taskId: 'task-1',
      label: 'Ralph Loop',
      status: 'cancelled',
      sessionId: 'session-1',
      eventId: 'evt-task-1',
      runId: 'run-task-1',
      occurredAt: 123,
    });

    expect(state.planTasks).toEqual([
      {
        id: 'task-1',
        label: 'Ralph Loop',
        status: 'cancelled',
      },
    ]);
    expect(state.dagNodes[0]).toMatchObject({ id: 'task-1', status: 'skipped' });
    expect(state.agentEvents.some((event) => event.label.includes('任务已取消'))).toBe(true);
  });

  it('preserves assignedAgent, result and errorMessage from task_update events', () => {
    const state = applyChatRightPanelEvent(createInitialChatRightPanelState(), {
      type: 'task_update',
      taskId: 'task-agent-1',
      label: '执行搜索',
      status: 'done',
      assignedAgent: 'oracle',
      result: '搜索完成，共 5 条结果',
      sessionId: 'session-1',
      eventId: 'evt-agent-1',
      runId: 'run-agent-1',
      occurredAt: 200,
    });

    expect(state.planTasks[0]).toMatchObject({
      id: 'task-agent-1',
      assignedAgent: 'oracle',
      result: '搜索完成，共 5 条结果',
    });
    expect(state.agentEvents.some((event) => event.label.includes('代理：oracle'))).toBe(true);
  });

  it('includes errorMessage in plan task and event label on failed task', () => {
    const state = applyChatRightPanelEvent(createInitialChatRightPanelState(), {
      type: 'task_update',
      taskId: 'task-fail-1',
      label: '执行写入',
      status: 'failed',
      assignedAgent: 'hephaestus',
      errorMessage: '权限不足，写入失败',
      sessionId: 'session-1',
      eventId: 'evt-fail-1',
      runId: 'run-fail-1',
      occurredAt: 300,
    });

    expect(state.planTasks[0]).toMatchObject({
      id: 'task-fail-1',
      assignedAgent: 'hephaestus',
      errorMessage: '权限不足，写入失败',
    });
    expect(
      state.agentEvents.some((event) => event.label.includes('错误：权限不足，写入失败')),
    ).toBe(true);
  });

  it('keeps pending task updates as pending in the DAG view', () => {
    const state = applyChatRightPanelEvent(createInitialChatRightPanelState(), {
      type: 'task_update',
      taskId: 'task-2',
      label: 'Start Work',
      status: 'pending',
      sessionId: 'session-1',
      eventId: 'evt-task-2',
      runId: 'run-task-2',
      occurredAt: 456,
    });

    expect(state.planTasks[0]).toMatchObject({ id: 'task-2', status: 'pending' });
    expect(state.dagNodes[0]).toMatchObject({ id: 'task-2', status: 'pending' });
  });

  it('preserves parent-child task relationships in plan and dag views', () => {
    const withParent = applyChatRightPanelEvent(createInitialChatRightPanelState(), {
      type: 'task_update',
      taskId: 'task-root',
      label: '执行计划',
      status: 'in_progress',
      sessionId: 'session-1',
      eventId: 'evt-task-root',
      runId: 'run-task-root',
      occurredAt: 100,
    });
    const withChild = applyChatRightPanelEvent(withParent, {
      type: 'task_update',
      taskId: 'task-child',
      label: '实现子任务',
      status: 'pending',
      sessionId: 'session-1',
      parentTaskId: 'task-root',
      eventId: 'evt-task-child',
      runId: 'run-task-root',
      occurredAt: 101,
    });

    expect(withChild.planTasks).toEqual([
      {
        id: 'task-root',
        label: '执行计划',
        status: 'in_progress',
        parentTaskId: undefined,
      },
      {
        id: 'task-child',
        label: '实现子任务',
        status: 'pending',
        parentTaskId: 'task-root',
      },
    ]);
    expect(withChild.dagEdges).toEqual([
      {
        id: 'assistant-orchestrator->task-root',
        source: 'assistant-orchestrator',
        target: 'task-root',
        label: '计划',
      },
      {
        id: 'task-root->task-child',
        source: 'task-root',
        target: 'task-child',
        label: '子任务',
      },
    ]);
  });
});
