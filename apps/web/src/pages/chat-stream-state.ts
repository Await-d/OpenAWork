import type { RunEvent, StreamChunk } from '@openAwork/shared';
import type {
  AgentVizEvent,
  DAGNodeInfo,
  DAGEdgeInfo,
  HistoricalPlan,
  PlanTask,
  StepRowProps,
} from '@openAwork/shared-ui';

type ChatPlanTask = PlanTask & {
  parentTaskId?: string;
  assignedAgent?: string;
  category?: string;
  requestedSkills?: string[];
  result?: string;
  errorMessage?: string;
};

type ChatTaskUpdateEvent = Extract<RunEvent, { type: 'task_update' }> & {
  parentTaskId?: string;
};

type ChatRunEvent = Exclude<RunEvent, { type: 'task_update' }> | ChatTaskUpdateEvent;

export interface ChatToolCallEntry {
  toolCallId: string;
  toolName: string;
  inputText: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  pendingPermissionRequestId?: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
}

export interface ChatRightPanelState {
  planTasks: ChatPlanTask[];
  agentEvents: AgentVizEvent[];
  planHistory: HistoricalPlan[];
  dagNodes: DAGNodeInfo[];
  dagEdges: DAGEdgeInfo[];
  toolCalls: ChatToolCallEntry[];
  compactions: Array<{
    id: string;
    summary: string;
    trigger: 'manual' | 'automatic';
    occurredAt: number;
  }>;
  currentGoal: string;
}

export interface ToolCallCardModel {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError: boolean;
  status: ChatToolCallEntry['status'];
}

type ChatPlanTaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';

const ORCHESTRATOR_ID = 'assistant-orchestrator';
const AGENT_ID = 'assistant';
const AGENT_NAME = 'Assistant';

export function createInitialChatRightPanelState(): ChatRightPanelState {
  return {
    planTasks: [],
    agentEvents: [],
    planHistory: [],
    dagNodes: [],
    dagEdges: [],
    toolCalls: [],
    compactions: [],
    currentGoal: '',
  };
}

export function startChatRightPanelRun(
  state: ChatRightPanelState,
  goal: string,
): ChatRightPanelState {
  return {
    ...state,
    currentGoal: goal,
    planTasks: [],
    toolCalls: [],
    dagEdges: [],
    dagNodes: [
      {
        id: ORCHESTRATOR_ID,
        label: '当前对话',
        type: 'orchestrator',
        status: 'running',
      },
    ],
    agentEvents: [...state.agentEvents, createEvent('agent_started', '开始处理用户请求')],
  };
}

export function getToolCallCards(state: ChatRightPanelState): ToolCallCardModel[] {
  return state.toolCalls.map((toolCall) => ({
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: toolCall.input,
    output: toolCall.output,
    isError: toolCall.isError === true || toolCall.status === 'failed',
    status: toolCall.status,
  }));
}

export function applyChatRightPanelChunk(
  state: ChatRightPanelState,
  chunk: StreamChunk,
): ChatRightPanelState {
  switch (chunk.type) {
    case 'text_delta':
    case 'thinking_delta':
      return state;
    case 'tool_call_delta':
      return applyToolCallDelta(state, chunk);
    case 'done':
      return finalizeRun(state, chunk.stopReason === 'error' ? 'failed' : 'completed', undefined);
    case 'error':
      return finalizeRun(state, 'failed', chunk.message);
  }

  return state;
}

export function applyChatRightPanelEvent(
  state: ChatRightPanelState,
  event: ChatRunEvent,
): ChatRightPanelState {
  if (event.type === 'task_update') {
    return applyTaskUpdateEvent(state, event);
  }

  if (event.type === 'compaction') {
    return {
      ...state,
      compactions: [
        {
          id: event.eventId ?? createId('compaction'),
          summary: event.summary,
          trigger: event.trigger,
          occurredAt: event.occurredAt ?? Date.now(),
        },
        ...state.compactions,
      ],
      agentEvents: [...state.agentEvents, createEvent('agent_done', '已记录会话压缩结果')],
    };
  }

  if (event.type === 'tool_result') {
    return applyToolResultEvent(state, event);
  }

  if (event.type === 'permission_asked') {
    return {
      ...state,
      agentEvents: [
        ...state.agentEvents,
        createEvent(
          'agent_thinking',
          `等待权限：${event.toolName}${event.previewAction ? ` · ${event.previewAction}` : ''}`,
        ),
      ],
    };
  }

  if (event.type === 'permission_replied') {
    return {
      ...state,
      agentEvents: [
        ...state.agentEvents,
        createEvent('agent_done', `权限已响应：${formatPermissionDecision(event.decision)}`),
      ],
    };
  }

  if (event.type === 'session_child') {
    return {
      ...state,
      agentEvents: [
        ...state.agentEvents,
        createEvent('agent_done', `已创建子会话：${event.title ?? event.sessionId}`),
      ],
    };
  }

  if (event.type === 'audit_ref') {
    return {
      ...state,
      agentEvents: [...state.agentEvents, createEvent('agent_thinking', '已记录审计引用')],
    };
  }

  if (
    event.type === 'text_delta' ||
    event.type === 'tool_call_delta' ||
    event.type === 'done' ||
    event.type === 'error'
  ) {
    return applyChatRightPanelChunk(state, event);
  }

  return state;
}

function applyTaskUpdateEvent(
  state: ChatRightPanelState,
  event: ChatTaskUpdateEvent,
): ChatRightPanelState {
  const taskStatus = normalizeTaskStatus(event.status);
  const existingTask = state.planTasks.find((task) => task.id === event.taskId);
  const parentTaskId = event.parentTaskId ?? existingTask?.parentTaskId;
  const planTasks = upsertById(state.planTasks, event.taskId, {
    id: event.taskId,
    label: event.label,
    status: taskStatus,
    parentTaskId,
    assignedAgent: event.assignedAgent ?? existingTask?.assignedAgent,
    category: event.category ?? existingTask?.category,
    requestedSkills: event.requestedSkills ?? existingTask?.requestedSkills,
    result: event.result ?? existingTask?.result,
    errorMessage: event.errorMessage ?? existingTask?.errorMessage,
  });

  const dagNodes = upsertById(state.dagNodes, event.taskId, {
    id: event.taskId,
    label: event.label,
    type: 'tool' as const,
    status:
      taskStatus === 'in_progress'
        ? ('running' as const)
        : taskStatus === 'done'
          ? ('completed' as const)
          : taskStatus === 'pending'
            ? ('pending' as const)
            : taskStatus === 'cancelled'
              ? ('skipped' as const)
              : ('failed' as const),
  });
  const dagEdges = [
    ...state.dagEdges.filter((edge) => edge.target !== event.taskId),
    {
      id: `${parentTaskId ?? ORCHESTRATOR_ID}->${event.taskId}`,
      source: parentTaskId ?? ORCHESTRATOR_ID,
      target: event.taskId,
      label: parentTaskId ? '子任务' : '计划',
    },
  ];

  const label =
    event.status === 'cancelled' ? `任务已取消：${event.label}` : `任务状态更新：${event.label}`;

  const agentEventLabel = buildTaskEventLabel(
    label,
    event.assignedAgent,
    event.result,
    event.errorMessage,
  );

  return {
    ...state,
    planTasks,
    dagNodes,
    dagEdges,
    agentEvents: [...state.agentEvents, createEvent('agent_thinking', agentEventLabel)],
  };
}

function normalizeTaskStatus(status: ChatTaskUpdateEvent['status']): ChatPlanTaskStatus {
  return status;
}

function buildTaskEventLabel(
  base: string,
  assignedAgent?: string,
  result?: string,
  errorMessage?: string,
): string {
  const parts: string[] = [base];
  if (assignedAgent) parts.push(`代理：${assignedAgent}`);
  if (errorMessage) parts.push(`错误：${truncate(errorMessage, 60)}`);
  else if (result) parts.push(`结果：${truncate(result, 60)}`);
  return parts.join(' · ');
}

function applyToolCallDelta(
  state: ChatRightPanelState,
  chunk: Extract<StreamChunk, { type: 'tool_call_delta' }>,
): ChatRightPanelState {
  const existingToolCall = state.toolCalls.find((item) => item.toolCallId === chunk.toolCallId);
  const nextInputText = (existingToolCall?.inputText ?? '') + chunk.inputDelta;
  const nextInput = parseToolInput(nextInputText);

  const toolCalls = upsertById(state.toolCalls, chunk.toolCallId, {
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    inputText: nextInputText,
    input: nextInput,
    status: 'running' as const,
  });

  const planTasks = upsertById(state.planTasks, chunk.toolCallId, {
    id: chunk.toolCallId,
    label: chunk.toolName,
    status: 'in_progress' as const,
  });

  const dagNodes = upsertById(state.dagNodes, chunk.toolCallId, {
    id: chunk.toolCallId,
    label: chunk.toolName,
    type: 'tool' as const,
    status: 'running' as const,
  });

  const dagEdges = state.dagEdges.some((edge) => edge.target === chunk.toolCallId)
    ? state.dagEdges
    : [
        ...state.dagEdges,
        {
          id: `${ORCHESTRATOR_ID}->${chunk.toolCallId}`,
          source: ORCHESTRATOR_ID,
          target: chunk.toolCallId,
          label: '调用',
        },
      ];

  const hasToolEvent = state.agentEvents.some(
    (event) => event.type === 'tool_call' && event.label === `调用 ${chunk.toolName}`,
  );
  const agentEvents = hasToolEvent
    ? state.agentEvents
    : [...state.agentEvents, createEvent('tool_call', `调用 ${chunk.toolName}`)];

  return {
    ...state,
    toolCalls,
    planTasks,
    dagNodes,
    dagEdges,
    agentEvents,
  };
}

function applyToolResultEvent(
  state: ChatRightPanelState,
  event: Extract<RunEvent, { type: 'tool_result' }>,
): ChatRightPanelState {
  const isPendingPermission = typeof event.pendingPermissionRequestId === 'string';
  const status = isPendingPermission
    ? ('paused' as const)
    : event.isError
      ? ('failed' as const)
      : ('completed' as const);
  const existing = state.toolCalls.find((item) => item.toolCallId === event.toolCallId);
  const toolCalls = upsertById(state.toolCalls, event.toolCallId, {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    inputText: existing?.inputText ?? '',
    input: existing?.input ?? {},
    output: event.output,
    isError: isPendingPermission ? false : event.isError,
    pendingPermissionRequestId: event.pendingPermissionRequestId,
    status,
  });

  const planTasks = upsertById(state.planTasks, event.toolCallId, {
    id: event.toolCallId,
    label: event.toolName,
    status: isPendingPermission
      ? ('pending' as const)
      : event.isError
        ? ('failed' as const)
        : ('done' as const),
  });

  const dagNodes = upsertById(state.dagNodes, event.toolCallId, {
    id: event.toolCallId,
    label: event.toolName,
    type: 'tool' as const,
    status: isPendingPermission
      ? ('pending' as const)
      : event.isError
        ? ('failed' as const)
        : ('completed' as const),
  });

  return {
    ...state,
    toolCalls,
    planTasks,
    dagNodes,
    agentEvents: [
      ...state.agentEvents,
      createEvent(
        isPendingPermission ? 'agent_thinking' : event.isError ? 'agent_error' : 'tool_done',
        isPendingPermission
          ? `等待权限：${event.toolName}`
          : event.isError
            ? `工具失败：${event.toolName}`
            : `工具完成：${event.toolName}`,
        isPendingPermission || event.isError ? stringifyToolOutput(event.output) : undefined,
      ),
    ],
  };
}

function finalizeRun(
  state: ChatRightPanelState,
  status: 'completed' | 'failed',
  error?: string,
): ChatRightPanelState {
  const nextPlanStatus = status === 'completed' ? ('done' as const) : ('failed' as const);
  const nextToolStatus = status === 'completed' ? ('completed' as const) : ('failed' as const);
  const nextNodeStatus = status === 'completed' ? ('completed' as const) : ('failed' as const);

  const planTasks = state.planTasks.map((task) => ({
    ...task,
    status:
      status === 'completed' && task.status === 'failed'
        ? ('failed' as const)
        : status === 'completed' && task.status === 'cancelled'
          ? ('cancelled' as const)
          : nextPlanStatus,
  }));

  const toolCalls = state.toolCalls.map((item) => ({
    ...item,
    status:
      status === 'completed' && item.status === 'failed' ? ('failed' as const) : nextToolStatus,
  }));

  const dagNodes = state.dagNodes.map((node) => ({
    ...node,
    status:
      status === 'completed' && node.status === 'failed'
        ? ('failed' as const)
        : status === 'completed' && node.status === 'skipped'
          ? ('skipped' as const)
          : nextNodeStatus,
  }));

  const finalEvent =
    status === 'completed'
      ? createEvent('agent_done', '流式响应完成')
      : createEvent('agent_error', '流式响应失败', error);

  const historyEntry = planTasks.length
    ? {
        id: createId('plan'),
        title: state.currentGoal ? truncate(state.currentGoal, 24) : '最近一次工具计划',
        goal: state.currentGoal,
        status,
        createdAt: Date.now(),
        steps: planTasks.map((task, index) =>
          createStep(index, task.label, status === 'completed' ? 'completed' : 'failed'),
        ),
      }
    : null;

  return {
    ...state,
    planTasks,
    toolCalls,
    dagNodes,
    agentEvents: [...state.agentEvents, finalEvent],
    planHistory: historyEntry ? [historyEntry, ...state.planHistory] : state.planHistory,
  };
}

function createEvent(type: AgentVizEvent['type'], label: string, error?: string): AgentVizEvent {
  return {
    id: createId('event'),
    ts: Date.now(),
    type,
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    label,
    ...(error ? { error } : {}),
  };
}

function createStep(index: number, title: string, status: StepRowProps['status']): StepRowProps {
  return {
    id: createId('step'),
    index: index + 1,
    title,
    status,
  };
}

function parseToolInput(inputText: string): Record<string, unknown> {
  const normalized = inputText.trim();
  if (normalized.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { raw: normalized };
  }
  return { raw: normalized };
}

function upsertById<T extends { id: string }>(items: T[], id: string, nextItem: T): T[];
function upsertById<T extends { toolCallId: string }>(items: T[], id: string, nextItem: T): T[];
function upsertById<T>(items: T[], id: string, nextItem: T): T[] {
  const index = items.findIndex((item) => {
    if (typeof item !== 'object' || item === null) return false;
    if ('id' in item && typeof item.id === 'string') return item.id === id;
    if ('toolCallId' in item && typeof item.toolCallId === 'string') return item.toolCallId === id;
    return false;
  });
  if (index === -1) return [...items, nextItem];
  return items.map((item, itemIndex) => (itemIndex === index ? nextItem : item));
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function formatPermissionDecision(
  decision: Extract<RunEvent, { type: 'permission_replied' }>['decision'],
): string {
  switch (decision) {
    case 'once':
      return '本次允许';
    case 'session':
      return '本会话允许';
    case 'permanent':
      return '永久允许';
    case 'reject':
      return '已拒绝';
  }
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output);
  } catch {
    return '工具输出不可序列化';
  }
}
