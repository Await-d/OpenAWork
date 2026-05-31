import { getProviderUiList } from '@openAwork/shared-ui';
import type {
  AgentTeamsTabDefinition,
  AgentTeamsTimelineEventType,
  TeamTemplateProviderOption,
} from './team-runtime-types.js';

export const agentTeamsTabs: AgentTeamsTabDefinition[] = [
  { id: 'office', label: '办公室', icon: 'office' },
  { id: 'overview', label: '状态总览', icon: 'overview' },
  { id: 'conversation', label: '对话', icon: 'conversation' },
  { id: 'tasks', label: '任务', icon: 'tasks', badge: '1' },
  { id: 'messages', label: '消息', icon: 'messages' },
  { id: 'review', label: '评审', icon: 'review' },
  { id: 'teams', label: '团队', icon: 'teams' },
];

/**
 * 各平台的「推荐默认模型/力度」覆盖表。平台清单本身由 catalog 派生(新增平台
 * 自动出现在团队模板下拉里)，这里只补充各平台的推荐默认 modelId / variant。
 */
const TEAM_TEMPLATE_PROVIDER_DEFAULTS: Record<string, { modelId?: string; variant?: string }> = {
  anthropic: { modelId: 'claude-sonnet-4-6', variant: 'high' },
  openai: { modelId: 'gpt-5.4', variant: 'high' },
  gemini: { modelId: 'gemini-3.1-pro', variant: 'high' },
  deepseek: { modelId: 'deepseek-r2', variant: 'high' },
  qwen: { modelId: 'qwen3-coder', variant: 'medium' },
  moonshot: { modelId: 'kimi-k2.5', variant: 'medium' },
  mimo: { modelId: 'mimo-v2.5-pro', variant: 'high' },
};

/**
 * 团队模板的平台选项：从 catalog(单一事实来源)派生，叠加推荐默认模型覆盖。
 * 新增平台只需在后端 catalog 注册，这里会自动出现，无需改本文件。
 */
export const agentTeamsNewTemplateProviders: TeamTemplateProviderOption[] = getProviderUiList().map(
  (entry) => {
    const defaults = TEAM_TEMPLATE_PROVIDER_DEFAULTS[entry.type];
    return {
      value: entry.type,
      label: entry.displayName,
      ...(defaults?.modelId ? { modelId: defaults.modelId } : {}),
      ...(defaults?.variant ? { variant: defaults.variant } : {}),
    };
  },
);

export const AGENT_TEAMS_EVENT_CONFIG: Record<
  AgentTeamsTimelineEventType,
  { color: string; icon: string; label: string }
> = {
  session_start: { color: 'var(--success)', label: '启动', icon: 'play' },
  thinking: { color: 'var(--chart-5)', label: '思考', icon: 'thinking' },
  read: { color: 'var(--aux)', label: '读取', icon: 'file-read' },
  write: { color: 'var(--chart-5)', label: '写入', icon: 'file-write' },
  file_create: { color: 'var(--chart-5)', label: '创建', icon: 'file-create' },
  command_execute: { color: 'var(--warning)', label: '命令', icon: 'command' },
  tool_use: { color: 'var(--aux)', label: '工具', icon: 'tool' },
  error: { color: 'var(--danger)', label: '错误', icon: 'error' },
  waiting_confirmation: { color: 'var(--warning)', label: '确认', icon: 'confirm' },
  user_input: { color: 'var(--success)', label: '输入', icon: 'input' },
  turn_complete: { color: 'var(--aux)', label: '回合完成', icon: 'turn-complete' },
  task_complete: { color: 'var(--success)', label: '完成', icon: 'task-complete' },
  assistant_message: { color: 'var(--aux)', label: '回复', icon: 'reply' },
};
