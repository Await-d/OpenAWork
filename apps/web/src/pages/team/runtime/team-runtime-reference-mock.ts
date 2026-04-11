import type { SharedSessionSummaryRecord } from '@openAwork/web-client';
import type { CapabilityDescriptor, CoreRole, ManagedAgentRecord } from '@openAwork/shared';
import type { TeamRuntimeMetric, TeamWorkspaceCardSummary } from './team-runtime-model.js';

export interface ReferenceWorkbenchMessage {
  body: string;
  id: string;
  meta: string;
  tone: 'agent' | 'system' | 'user';
  title: string;
}

export interface ReferenceSessionCard {
  duration: string;
  id: string;
  provider: string;
  status: string;
  summary: string;
  title: string;
  tokens: string;
}

export interface ReferenceActivityItem {
  detail: string;
  id: string;
  sessionName: string;
  timestamp: string;
}

export interface ReferenceKanbanColumn {
  cards: Array<{
    id: string;
    owner: string;
    title: string;
  }>;
  id: string;
  title: string;
}

export interface ReferenceFileTreeNode {
  children?: ReferenceFileTreeNode[];
  changed?: boolean;
  name: string;
}

const agents: ManagedAgentRecord[] = [
  {
    id: 'agent-planner-1',
    label: 'Planner Prime',
    description: '负责规划拆解',
    aliases: [],
    canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
    model: 'gpt-5.4',
    variant: undefined,
    fallbackModels: [],
    systemPrompt: undefined,
    note: undefined,
    origin: 'builtin',
    source: 'builtin',
    enabled: true,
    removable: false,
    resettable: true,
    hasOverrides: false,
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  },
  {
    id: 'agent-executor-1',
    label: 'Executor Flux',
    description: '负责执行实现',
    aliases: [],
    canonicalRole: { coreRole: 'executor', preset: 'default', confidence: 'medium' },
    model: 'gpt-5.4',
    variant: undefined,
    fallbackModels: [],
    systemPrompt: undefined,
    note: undefined,
    origin: 'builtin',
    source: 'builtin',
    enabled: true,
    removable: false,
    resettable: true,
    hasOverrides: false,
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  },
  {
    id: 'agent-reviewer-1',
    label: 'Reviewer Halo',
    description: '负责收口复核',
    aliases: [],
    canonicalRole: { coreRole: 'reviewer', preset: 'critic', confidence: 'medium' },
    model: 'gpt-5.4',
    variant: undefined,
    fallbackModels: [],
    systemPrompt: undefined,
    note: undefined,
    origin: 'builtin',
    source: 'builtin',
    enabled: true,
    removable: false,
    resettable: true,
    hasOverrides: false,
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  },
];

const capabilities: CapabilityDescriptor[] = [
  {
    id: 'cap-plan',
    kind: 'tool',
    label: '任务拆解',
    description: '适合拆解复杂任务',
    source: 'builtin',
    enabled: true,
    callable: true,
    canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
  },
  {
    id: 'cap-code',
    kind: 'tool',
    label: '代码执行',
    description: '适合执行实现任务',
    source: 'builtin',
    enabled: true,
    callable: true,
    canonicalRole: { coreRole: 'executor', preset: 'default', confidence: 'medium' },
  },
  {
    id: 'cap-review',
    kind: 'tool',
    label: '质量复核',
    description: '适合审查和收口',
    source: 'builtin',
    enabled: true,
    callable: true,
    canonicalRole: { coreRole: 'reviewer', preset: 'critic', confidence: 'medium' },
  },
];

export const referenceTabs = [
  { key: 'dashboard', label: '仪表盘', summary: '主控制台、多会话概览与用量统计' },
  { key: 'sessions', label: '会话', summary: '多标签会话、结构化对话与工具执行流' },
  { key: 'files', label: '文件', summary: '文件树、改动列表与代码预览' },
  { key: 'kanban', label: '看板', summary: '团队任务流转、队列和负责人视图' },
] as const;

export const referenceMetrics: TeamRuntimeMetric[] = [
  { label: '总会话', value: 209, hint: '历史与当前会话总数' },
  { label: '运行中', value: 12, hint: '当前活跃会话与 Agent 子任务' },
  { label: '等待输入', value: 5, hint: '需要人工继续输入的会话' },
  { label: '今日 Token', value: '4.8M', hint: '最近 24 小时估算消耗' },
];

export const referenceWorkspaceSummaries: TeamWorkspaceCardSummary[] = [
  {
    key: '/repo/claudeops',
    label: '/repo/claudeops',
    description: '68 个会话 · 14 个共享运行 · 9 条共享记录 · 12 个运行中',
    pausedCount: 2,
    runningCount: 12,
    sessionCount: 68,
    sharedSessionCount: 14,
    shareRecordCount: 9,
  },
  {
    key: '/repo/openawork',
    label: '/repo/openawork',
    description: '44 个会话 · 9 个共享运行 · 6 条共享记录 · 6 个运行中',
    pausedCount: 1,
    runningCount: 6,
    sessionCount: 44,
    sharedSessionCount: 9,
    shareRecordCount: 6,
  },
  {
    key: '/repo/research-lab',
    label: '/repo/research-lab',
    description: '97 个会话 · 18 个共享运行 · 12 条共享记录 · 4 个运行中',
    pausedCount: 6,
    runningCount: 4,
    sessionCount: 97,
    sharedSessionCount: 18,
    shareRecordCount: 12,
  },
];

export const referenceOverviewLines = [
  '左侧保持项目树和会话列表，中间持续展示当前主工作区，右侧固定为监控与 Agent 详情。',
  '本页当前完全使用 mock 数据，用于一比一还原 SpectrAI 风格工作台的页面结构与信息密度。',
  '顶部 chrome、底部状态栏、右侧 detail rail 与多标签主面板均作为稳定骨架保留。',
];

export const referenceSharedSessions: SharedSessionSummaryRecord[] = [
  {
    sessionId: 'spectrai-session-1',
    title: 'ClaudeOps Sprint Sync',
    stateStatus: 'running',
    workspacePath: '/repo/claudeops',
    sharedByEmail: 'captain@spectrai.local',
    permission: 'operate',
    createdAt: '2026-04-11T08:00:00.000Z',
    updatedAt: '2026-04-11T08:10:00.000Z',
    shareCreatedAt: '2026-04-11T08:10:00.000Z',
    shareUpdatedAt: '2026-04-11T08:10:00.000Z',
  },
  {
    sessionId: 'spectrai-session-2',
    title: 'Agent Tree Audit',
    stateStatus: 'paused',
    workspacePath: '/repo/openawork',
    sharedByEmail: 'review@spectrai.local',
    permission: 'operate',
    createdAt: '2026-04-11T09:00:00.000Z',
    updatedAt: '2026-04-11T09:12:00.000Z',
    shareCreatedAt: '2026-04-11T09:12:00.000Z',
    shareUpdatedAt: '2026-04-11T09:12:00.000Z',
  },
  {
    sessionId: 'spectrai-session-3',
    title: 'Telegram Bot Rollout',
    stateStatus: 'running',
    workspacePath: '/repo/research-lab',
    sharedByEmail: 'ops@spectrai.local',
    permission: 'operate',
    createdAt: '2026-04-11T10:00:00.000Z',
    updatedAt: '2026-04-11T10:40:00.000Z',
    shareCreatedAt: '2026-04-11T10:40:00.000Z',
    shareUpdatedAt: '2026-04-11T10:40:00.000Z',
  },
];

export const referenceRoleBindingCards: Array<{
  recommendedCapabilities: CapabilityDescriptor[];
  role: CoreRole;
  roleLabel: string;
  selectedAgent: ManagedAgentRecord | null;
  selectedAgentId: string;
}> = [
  {
    role: 'planner',
    roleLabel: 'Planner',
    selectedAgent: agents[0] ?? null,
    selectedAgentId: agents[0]?.id ?? '',
    recommendedCapabilities: [capabilities[0]!],
  },
  {
    role: 'executor',
    roleLabel: 'Executor',
    selectedAgent: agents[1] ?? null,
    selectedAgentId: agents[1]?.id ?? '',
    recommendedCapabilities: [capabilities[1]!],
  },
  {
    role: 'reviewer',
    roleLabel: 'Reviewer',
    selectedAgent: agents[2] ?? null,
    selectedAgentId: agents[2]?.id ?? '',
    recommendedCapabilities: [capabilities[2]!],
  },
];

export const referencePaneAgents = agents;

export const referenceBuddyProjection = {
  activeAgentCount: 14,
  blockedCount: 1,
  pendingApprovalCount: 2,
  pendingQuestionCount: 3,
  runningCount: 12,
  sessionTitle: 'ClaudeOps Sprint Sync',
  workspaceLabel: '/repo/claudeops',
};

export const referenceSelectedRunSummary = {
  activeViewerCount: 4,
  commentCount: 12,
  pendingApprovalCount: 2,
  pendingQuestionCount: 1,
  sharedByEmail: 'captain@spectrai.local',
  stateLabel: '运行中',
  title: 'ClaudeOps Sprint Sync',
  workspaceLabel: '/repo/claudeops',
};

export const referenceSessionCards: ReferenceSessionCard[] = [
  {
    id: 'session-card-1',
    title: 'ClaudeOps Sprint Sync',
    status: '运行中',
    duration: '1h 42m',
    provider: 'Claude Code',
    tokens: '124K',
    summary: '聚焦当前 Sprint 的 Agent 编排与阻塞收敛。',
  },
  {
    id: 'session-card-2',
    title: 'Agent Tree Audit',
    status: '等待输入',
    duration: '28m',
    provider: 'Codex CLI',
    tokens: '38K',
    summary: '检查子任务树和会话恢复链的一致性。',
  },
  {
    id: 'session-card-3',
    title: 'Telegram Bot Rollout',
    status: '运行中',
    duration: '2h 10m',
    provider: 'Gemini CLI',
    tokens: '86K',
    summary: '正在批量梳理远程通知与 Markdown 输出问题。',
  },
  {
    id: 'session-card-4',
    title: 'UI Pane Semantics',
    status: '已完成',
    duration: '43m',
    provider: 'OpenCode',
    tokens: '19K',
    summary: '完成 pane collapse/resize 语义和 detail rail 位置锚定。',
  },
];

export const referenceActivities: ReferenceActivityItem[] = [
  {
    id: 'activity-1',
    timestamp: '14:21:06',
    sessionName: 'ClaudeOps Sprint Sync',
    detail: 'Planner Prime 将 Sprint 风险项重新归并为 4 个主线任务。',
  },
  {
    id: 'activity-2',
    timestamp: '14:20:18',
    sessionName: 'Agent Tree Audit',
    detail: 'Reviewer Halo 输出子 Agent 生命周期与状态机对照结论。',
  },
  {
    id: 'activity-3',
    timestamp: '14:18:42',
    sessionName: 'Telegram Bot Rollout',
    detail: 'Gemini 子任务写入远程通知 Markdown 模板草案。',
  },
  {
    id: 'activity-4',
    timestamp: '14:16:10',
    sessionName: 'UI Pane Semantics',
    detail: 'Executor Flux 完成 detail rail 固定列位与拖拽宽度调优。',
  },
];

export const referenceMessages: ReferenceWorkbenchMessage[] = [
  {
    id: 'message-1',
    title: 'Claude Code · 分析结果',
    meta: 'D:/desk_code/claudeops · 运行中',
    tone: 'agent',
    body: '已完成当前 Sprint 风险扫描，建议优先处理 pane collapse 的 grid 锚定，再统一 detail rail 的面板切换语义。',
  },
  {
    id: 'message-2',
    title: 'Tool Use · Bash / Grep',
    meta: '工具执行卡片',
    tone: 'system',
    body: '扫描到 4 处 pane 位置错位风险，已将 Sidebar / Main / Detail 固定到独立列位。',
  },
  {
    id: 'message-3',
    title: 'User',
    meta: '输入',
    tone: 'user',
    body: '现在不看功能，就把页面布局一比一还原回来。',
  },
];

export const referenceKanbanColumns: ReferenceKanbanColumn[] = [
  {
    id: 'todo',
    title: '待办',
    cards: [
      { id: 'todo-1', title: '同步 SessionSidebar mock 树', owner: 'Planner Prime' },
      { id: 'todo-2', title: '补足 TitleBar 窗口 chrome 细节', owner: 'Executor Flux' },
    ],
  },
  {
    id: 'doing',
    title: '进行中',
    cards: [
      { id: 'doing-1', title: '还原 Dashboard 主控制台布局', owner: 'Executor Flux' },
      { id: 'doing-2', title: '对齐 Detail Rail 监控区信息密度', owner: 'Reviewer Halo' },
    ],
  },
  {
    id: 'waiting',
    title: '等待中',
    cards: [{ id: 'waiting-1', title: '等待用户确认页面观感', owner: 'Owner' }],
  },
  {
    id: 'done',
    title: '已完成',
    cards: [{ id: 'done-1', title: '固定 Detail Rail 中宽列位', owner: 'Executor Flux' }],
  },
];

export const referenceFileTree: ReferenceFileTreeNode[] = [
  {
    name: 'src',
    children: [
      {
        name: 'renderer',
        children: [
          {
            name: 'components',
            children: [{ name: 'layout', children: [{ name: 'AppLayout.tsx', changed: true }] }],
          },
          { name: 'dashboard', children: [{ name: 'DashboardView.tsx', changed: true }] },
        ],
      },
      {
        name: 'main',
        children: [{ name: 'team', children: [{ name: 'SharedTaskList.ts', changed: true }] }],
      },
    ],
  },
  { name: 'docs', children: [{ name: 'screenshots', children: [{ name: 'dashboard.png' }] }] },
];

export const referenceChangedFiles = [
  'src/renderer/components/layout/AppLayout.tsx',
  'src/renderer/components/dashboard/DashboardView.tsx',
  'src/main/team/SharedTaskList.ts',
];

export const referenceAgents = [
  {
    id: 'agent-run-1',
    title: 'Agent Tree Audit',
    status: '运行中',
    provider: 'Claude',
    path: 'desk_code/claudeops',
  },
  {
    id: 'agent-run-2',
    title: 'Telegram Bot Rollout',
    status: '等待输入',
    provider: 'Gemini',
    path: 'desk_code/claudeops',
  },
  {
    id: 'agent-run-3',
    title: 'UI Pane Semantics',
    status: '已完成',
    provider: 'Codex',
    path: 'desk_code/openawork',
  },
];
