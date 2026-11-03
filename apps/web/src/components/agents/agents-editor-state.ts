/**
 * Agent 编辑器表单状态与展示用标签表。
 *
 * 从原 `AgentsPageSections.tsx` 抽出：页面容器只关心动作编排，编辑器只关心
 * 表单字段，双方共用这里的类型与「记录 ↔ 表单」转换，避免两处各写一份。
 */

import type { CoreRole, ManagedAgentRecord, RolePreset } from '@openAwork/shared';

export type EditorMode = 'create' | 'edit';

export interface AgentEditorState {
  label: string;
  description: string;
  aliasesText: string;
  coreRole: '' | CoreRole;
  preset: '' | RolePreset;
  model: string;
  variant: string;
  fallbackModelsText: string;
  systemPrompt: string;
  note: string;
  enabled: boolean;
}

export const CORE_ROLE_OPTIONS: CoreRole[] = [
  'general',
  'researcher',
  'planner',
  'executor',
  'reviewer',
];

export const PRESET_OPTIONS: RolePreset[] = [
  'default',
  'explore',
  'analyst',
  'librarian',
  'architect',
  'debugger',
  'critic',
  'code-review',
  'test',
  'verifier',
];

export const CORE_ROLE_LABELS: Record<CoreRole, string> = {
  general: '通用',
  leader: '领导',
  researcher: '研究',
  planner: '规划',
  executor: '执行',
  reviewer: '评审',
};

export const PRESET_LABELS: Record<RolePreset, string> = {
  default: '默认',
  coordinator: '协调',
  explore: '探索',
  analyst: '分析',
  librarian: '资料检索',
  architect: '架构',
  debugger: '调试',
  critic: '挑刺',
  'code-review': '代码审查',
  test: '测试',
  verifier: '验收',
};

export const SOURCE_LABELS: Record<ManagedAgentRecord['source'], string> = {
  builtin: '内置',
  installed: '已安装',
  configured: '已配置',
  runtime: '运行时',
  reference: '内置',
  custom: '自定义',
};

export const ORIGIN_LABELS: Record<ManagedAgentRecord['origin'], string> = {
  builtin: '内置',
  custom: '自定义',
};

const BUILTIN_AGENT_DESCRIPTION_ZH: Record<string, string> = {
  build: '默认主智能体，负责统筹执行与结果交付。',
  plan: '规划智能体，负责拆解任务与安排执行顺序。',
  general: '通用智能体，适合未细分场景下的基础处理。',
  explore: '代码探索智能体，用于检索仓库结构、模式与实现线索。',
  sisyphus: '插件层执行智能体，用于协调插件相关执行流程。',
  hephaestus: '深度工程智能体，负责高强度实现、修复与交付。',
  prometheus: '战略规划智能体，用于大型任务的策略与阶段设计。',
  oracle: '只读顾问智能体，用于架构评审、设计权衡与谨慎复核。',
  librarian: '资料检索智能体，用于搜索外部文档、示例与参考实现。',
  metis: '预规划分析智能体，用于澄清需求与界定范围。',
  momus: '计划/质量审阅智能体，用于挑战方案、找出风险与漏洞。',
  atlas: '验收协调智能体，用于确认完成度与证据闭环。',
  'multimodal-looker': '多模态查看智能体，用于提取图片、界面等视觉输入信息。',
  'sisyphus-junior': '轻量执行智能体，用于快速完成分类明确的任务。',
};

export function localizeAgentDescription(agent: ManagedAgentRecord): string {
  if (agent.origin === 'builtin') {
    return BUILTIN_AGENT_DESCRIPTION_ZH[agent.id] ?? agent.description;
  }
  return agent.description;
}

export function formatCanonicalRoleZh(agent: ManagedAgentRecord): string | undefined {
  if (!agent.canonicalRole) {
    return undefined;
  }
  const core = CORE_ROLE_LABELS[agent.canonicalRole.coreRole] ?? agent.canonicalRole.coreRole;
  const preset = agent.canonicalRole.preset
    ? (PRESET_LABELS[agent.canonicalRole.preset] ?? agent.canonicalRole.preset)
    : undefined;
  return preset ? `${core} / ${preset}` : core;
}

export function emptyEditorState(): AgentEditorState {
  return {
    label: '',
    description: '',
    aliasesText: '',
    coreRole: '',
    preset: '',
    model: '',
    variant: '',
    fallbackModelsText: '',
    systemPrompt: '',
    note: '',
    enabled: true,
  };
}

export function toEditorState(agent: ManagedAgentRecord | null): AgentEditorState {
  if (!agent) {
    return emptyEditorState();
  }

  return {
    label: agent.label,
    description: agent.description,
    aliasesText: agent.aliases.join(', '),
    coreRole: agent.canonicalRole?.coreRole ?? '',
    preset: agent.canonicalRole?.preset ?? '',
    model: agent.model ?? '',
    variant: agent.variant ?? '',
    fallbackModelsText: (agent.fallbackModels ?? []).join(', '),
    systemPrompt: agent.systemPrompt ?? '',
    note: agent.note ?? '',
    enabled: agent.enabled,
  };
}

export function parseAliases(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}
