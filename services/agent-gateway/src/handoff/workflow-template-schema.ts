/**
 * 260516-team-phase-e · T-01
 *
 * teamWorkflow schema 定义。
 *
 * 一个 workflow 包定义了"从用户意图到最终交付"的完整步骤链。
 * 每个 step 声明：角色 / prompt 模板 / 可用工具集 / 下游 handoff 目标。
 */

import { z } from 'zod';

export const workflowStepSchema = z.object({
  /** 步骤唯一标识（在 workflow 内唯一） */
  id: z.string().min(1).max(80),
  /** 执行该步骤的角色层 */
  roleLayer: z.enum(['reception', 'pm1', 'pm2', 'executor', 'reviewer']),
  /** 步骤显示名 */
  label: z.string().min(1).max(200),
  /** 该步骤的 system prompt 模板（支持 {{constitution}} / {{spec}} 等变量） */
  promptTemplate: z.string().max(16000).default(''),
  /** 该步骤允许使用的工具集 */
  toolsets: z.array(z.string()).default(['read', 'write', 'shell']),
  /** 完成后自动创建的下游 handoff 目标（step id 列表） */
  handoffTargets: z.array(z.string()).default([]),
  /** 是否可并行执行（多个实例） */
  parallel: z.boolean().default(false),
  /** 最少并行实例数（仅 parallel=true 时有效） */
  minInstances: z.number().int().min(1).default(1),
  /** 最多并行实例数 */
  maxInstances: z.number().int().min(1).default(8),
  /** 门禁：执行前必须通过的检查 */
  gates: z.array(z.enum(['constitution-check', 'spec-review', 'quality-review'])).default([]),
  /** 是否为终止步骤（完成后 workflow 结束） */
  terminal: z.boolean().default(false),
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const teamWorkflowSchema = z.object({
  /** workflow 包唯一标识 */
  id: z.string().min(1).max(120),
  /** 显示名 */
  name: z.string().min(1).max(200),
  /** 一句话描述 */
  description: z.string().max(500).default(''),
  /** 版本号 */
  version: z.string().default('1.0.0'),
  /** 来源：builtin（内置）/ custom（用户自定义）/ forked（从内置 fork） */
  source: z.enum(['builtin', 'custom', 'forked']).default('custom'),
  /** 入口步骤 id */
  entryStepId: z.string().min(1),
  /** 所有步骤定义 */
  steps: z.array(workflowStepSchema).min(1),
  /** 默认角色绑定（roleLayer → agentId） */
  defaultBindings: z.record(z.string()).default({}),
  /** 适用场景标签 */
  tags: z.array(z.string()).default([]),
});

export type TeamWorkflow = z.infer<typeof teamWorkflowSchema>;

/**
 * 校验 workflow 内部一致性：
 *   - entryStepId 必须存在于 steps 中
 *   - handoffTargets 引用的 step id 必须存在
 *   - 至少有一个 terminal step
 */
export function validateWorkflowConsistency(workflow: TeamWorkflow): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const stepIds = new Set(workflow.steps.map((s) => s.id));

  if (!stepIds.has(workflow.entryStepId)) {
    errors.push(`entryStepId "${workflow.entryStepId}" 不存在于 steps 中`);
  }

  for (const step of workflow.steps) {
    for (const target of step.handoffTargets) {
      if (!stepIds.has(target)) {
        errors.push(`步骤 "${step.id}" 的 handoffTarget "${target}" 不存在`);
      }
    }
  }

  const hasTerminal = workflow.steps.some((s) => s.terminal);
  if (!hasTerminal) {
    errors.push('workflow 必须至少有一个 terminal step');
  }

  return { valid: errors.length === 0, errors };
}
