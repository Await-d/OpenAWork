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
  route: 'broadcast' | 'unicast';
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
  status: 'running' | 'paused' | 'completed' | 'failed';
  subtitle: string;
  title: string;
}

export interface AgentTeamsWorkspaceGroup {
  sessions: AgentTeamsSidebarTeam[];
  workspaceLabel: string;
  workspacePath: string | null;
}

export type AgentTeamsTimelineEventType =
  | 'session_start'
  | 'thinking'
  | 'file_read'
  | 'file_write'
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
  value: string;
}
