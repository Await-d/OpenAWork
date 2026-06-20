import type { WorkflowTemplateRecord } from '@openAwork/web-client';

export type AgentTeamsTabKey =
  | 'conversation'
  | 'tasks'
  | 'messages'
  | 'overview'
  | 'review'
  | 'teams'
  | 'office';

export interface AgentTeamsSidebarTemplateBadge {
  label: string;
  tone: 'default' | 'accent' | 'warning' | 'success';
}

export interface AgentTeamsWorkflowTemplateCard extends WorkflowTemplateRecord {
  badges?: AgentTeamsSidebarTemplateBadge[];
  groupId?: string;
  groupPriority?: number;
  groupTitle?: string;
  metaLine?: string;
}

export interface AgentTeamsSidebarTemplate {
  badges?: AgentTeamsSidebarTemplateBadge[];
  description: string;
  id: string;
  metaLine?: string;
  roleTagRows: Array<Array<{ color: string; label: string }>>;
  title: string;
}

export interface AgentTeamsSidebarSection {
  id: string;
  items: AgentTeamsSidebarTemplate[];
  title: string;
}

export interface AgentTeamsRoleChip {
  accent: string;
  badge: string;
  id: string;
  leader?: boolean;
  provider: string;
  role: string;
  status: string;
}

export type AgentOfficeStatus = 'working' | 'resting' | 'discussing';

export interface AgentTeamsOfficeAgent {
  accent: string;
  crown?: boolean;
  extraNote?: string;
  id: string;
  label: string;
  note: string;
  selected?: boolean;
  status: AgentOfficeStatus;
  x: number;
  y: number;
}

export interface AgentTeamsTabDefinition {
  badge?: string;
  icon: string;
  id: AgentTeamsTabKey;
  label: string;
}

export interface AgentTeamsMetricCard {
  icon: string;
  label: string;
  value: string;
}

export interface AgentTeamsFooterStat {
  label: string;
  value: string;
}

export interface AgentTeamsConversationCard {
  agentId?: string;
  body: string;
  id: string;
  meta: string;
  role: string;
  roleAccent: string;
  timestamp: string;
  title: string;
  type: 'broadcast' | 'direct' | 'question' | 'result';
}

export interface AgentTeamsTaskCard {
  assignee: string;
  assigneeAccent: string;
  description: string;
  id: string;
  mutable?: boolean;
  priority: 'high' | 'medium' | 'low';
  tags: string[];
  title: string;
}

export interface AgentTeamsTaskLane {
  cards: AgentTeamsTaskCard[];
  id: string;
  title: string;
}

export interface AgentTeamsMessageCard {
  from: string;
  fromAccent: string;
  id: string;
  sessionId?: string | null;
  memberId?: string | null;
  recipientMemberId?: string | null;
  replyToMessageId?: string | null;
  route: 'broadcast' | 'followup';
  summary: string;
  timestamp: string;
  to: string;
  toAccent: string;
  type: 'update' | 'question' | 'result' | 'error';
}

export interface AgentTeamsOverviewCard {
  icon: string;
  id: string;
  label: string;
  note: string;
  trend?: 'up' | 'down' | 'stable';
  value: string;
}

export interface AgentTeamsReviewCard {
  actionable?: boolean;
  assignee: string;
  assigneeAccent: string;
  id: string;
  priority: 'high' | 'medium' | 'low';
  requestId?: string;
  reviewKind?: 'audit' | 'permission' | 'question';
  sessionId?: string;
  status: 'pending' | 'approved' | 'rejected';
  summary: string;
  title: string;
  type: 'code' | 'design' | 'content' | 'security';
}

export interface AgentTeamsSidebarTeam {
  id: string;
  isSharedSession?: boolean;
  lastMessage?: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  subtitle: string;
  title: string;
  updatedAt?: string;
  /** 任务总数（关联到此 sessionId 的任务）。 */
  taskTotal?: number;
  /** 已完成任务数。 */
  taskCompleted?: number;
  /** 运行中任务数（用于 spinner 提示）。 */
  taskRunning?: number;
  /** 失败任务数（用于异常徽章）。 */
  taskFailed?: number;
  /** 待处理任务数。 */
  taskPending?: number;
  /** 子会话数（基于 parentSessionId 反向汇总）。 */
  childSessionCount?: number;
  /** 父会话 ID（用于团队会话树与删除级联提示）。 */
  parentSessionId?: string | null;
  /** 团队角色层（reception / pm1 / pm2 / executor / reviewer）。 */
  roleLayer?: string | null;
  /** 工作目录（从 metadataJson.workingDirectory 解析）。 */
  workingDirectory?: string;
  /** 是否为派生会话（有 parentSessionId）。 */
  isDerived?: boolean;
  /** 当前正在运行的任务标题（最早开始的一个）。 */
  currentTaskTitle?: string;
  /** 参与该会话的 agent 集合（来自 task.assignedAgent 去重）。 */
  agents?: string[];
  /** 该会话已运行的总耗时（毫秒，基于最早 startedAt 到现在；终态用 completedAt）。 */
  durationMs?: number;
  /** 创建时间（ISO 字符串），用于显示「创建于 …」。 */
  createdAt?: string;
}

export interface AgentTeamsWorkspaceGroup {
  sessions: AgentTeamsSidebarTeam[];
  workspaceLabel: string;
  workspacePath: string | null;
}

export type AgentTeamsTimelineEventType =
  | 'session_start'
  | 'thinking'
  | 'read'
  | 'write'
  | 'file_create'
  | 'command_execute'
  | 'tool_use'
  | 'error'
  | 'waiting_confirmation'
  | 'user_input'
  | 'turn_complete'
  | 'task_complete'
  | 'assistant_message';

export interface AgentTeamsTimelineEvent {
  agentAccent: string;
  agentId: string;
  agentName: string;
  detail: string;
  id: string;
  timestamp: string;
  type: AgentTeamsTimelineEventType;
}

export interface TeamTemplateProviderOption {
  label: string;
  modelId?: string;
  value: string;
  variant?: string;
}
