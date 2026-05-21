import type { WorkflowTemplateScale } from '@openAwork/web-client';

export const ROLE_COLOR_MAP: Record<string, string> = {
  团队领导: 'var(--warning)',
  领导: 'var(--warning)',
  团队负责人: 'var(--warning)',
  规划: 'var(--warning)',
  研究员: 'var(--accent)',
  研究: 'var(--accent)',
  执行者: 'var(--aux)',
  执行: 'var(--aux)',
  批评者: 'var(--danger)',
  审查: 'var(--danger)',
};

export const BUILTIN_AGENT_LABELS: Record<string, string> = {
  atlas: 'Atlas',
  metis: 'Metis',
  'sisyphus-junior': 'Sisyphus-Junior',
};

export const REQUIRED_TEMPLATE_ROLES: Array<
  'leader' | 'planner' | 'researcher' | 'executor' | 'reviewer'
> = ['leader', 'planner', 'researcher', 'executor', 'reviewer'];

export const ROLE_LABELS: Record<string, string> = {
  leader: '团队领导',
  planner: '团队负责人',
  researcher: '研究员',
  executor: '执行者',
  reviewer: '批评者',
};

export const SCALE_OPTIONS: { value: WorkflowTemplateScale; label: string }[] = [
  { value: 'small', label: '小型' },
  { value: 'medium', label: '中型' },
  { value: 'large', label: '大型' },
  { value: 'full', label: '完整' },
];

export const VARIANT_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'minimal', label: '极低', hint: '几乎不推理' },
  { value: 'low', label: '低', hint: '轻度推理' },
  { value: 'medium', label: '中', hint: '标准推理' },
  { value: 'high', label: '高', hint: '深度推理' },
  { value: 'xhigh', label: '极高', hint: '最大推理' },
];

export const fieldLabelStyle = {
  fontSize: 10,
  fontWeight: 700 as const,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

export const inputStyle = (valid?: boolean) => ({
  padding: '8px 12px',
  borderRadius: 8,
  border: valid
    ? '1px solid color-mix(in oklch, var(--success) 40%, transparent)'
    : '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--fg-strong)',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s',
  width: '100%',
  boxSizing: 'border-box' as const,
});

export const pillButtonStyle = (active: boolean, color: string) => ({
  padding: '5px 12px',
  borderRadius: 999,
  border: active
    ? `1px solid color-mix(in oklch, ${color} 50%, transparent)`
    : '1px solid var(--border-subtle)',
  background: active ? `color-mix(in oklch, ${color} 8%, var(--bg-base))` : 'var(--bg-surface)',
  color: active ? color : 'var(--fg-muted)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s',
});

export type EditorMode = 'idle' | 'create' | 'edit';

export interface RoleBindingEdit {
  providerId: string;
  modelId: string;
  variant: string;
}

export interface EditorState {
  name: string;
  description: string;
  provider: string;
  optionalAgentIds: Set<string>;
  scale: WorkflowTemplateScale;
  focus: string;
  recommendedFor: string;
  isRecommendedDefault: boolean;
  roleBindings: Record<string, RoleBindingEdit>;
}
