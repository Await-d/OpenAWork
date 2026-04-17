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

export const agentTeamsNewTemplateProviders: TeamTemplateProviderOption[] = [
  { value: 'anthropic', label: 'Anthropic', modelId: 'claude-sonnet-4-6', variant: 'high' },
  { value: 'openai', label: 'OpenAI', modelId: 'gpt-5.4', variant: 'high' },
  { value: 'gemini', label: 'Gemini', modelId: 'gemini-3.1-pro', variant: 'high' },
  { value: 'deepseek', label: 'DeepSeek', modelId: 'deepseek-r2', variant: 'high' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'qwen', label: 'Qwen', modelId: 'qwen3-coder', variant: 'medium' },
  { value: 'moonshot', label: 'Moonshot', modelId: 'kimi-k2.5', variant: 'medium' },
];

export const AGENT_TEAMS_EVENT_CONFIG: Record<
  AgentTeamsTimelineEventType,
  { color: string; icon: string; label: string }
> = {
  session_start: { color: '#3FB950', label: '启动', icon: 'play' },
  thinking: { color: '#BC8CFF', label: '思考', icon: 'thinking' },
  file_read: { color: '#58A6FF', label: '读取', icon: 'file-read' },
  file_write: { color: '#D2A8FF', label: '写入', icon: 'file-write' },
  file_create: { color: '#D2A8FF', label: '创建', icon: 'file-create' },
  command_execute: { color: '#D29922', label: '命令', icon: 'command' },
  tool_use: { color: '#58A6FF', label: '工具', icon: 'tool' },
  error: { color: '#F85149', label: '错误', icon: 'error' },
  waiting_confirmation: { color: '#D29922', label: '确认', icon: 'confirm' },
  user_input: { color: '#3FB950', label: '输入', icon: 'input' },
  turn_complete: { color: '#58A6FF', label: '回合完成', icon: 'turn-complete' },
  task_complete: { color: '#3FB950', label: '完成', icon: 'task-complete' },
  assistant_message: { color: '#79C0FF', label: '回复', icon: 'reply' },
};
