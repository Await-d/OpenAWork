/**
 * 260516-team-phase-e · T-04
 *
 * 模板驱动 handoff 流程。
 *
 * 当 feature flag `OPENAWORK_TEAM_WORKFLOW_DRIVEN=1` 开启时，watcher 使用
 * 此 runner 替代硬编码的 pm1-runner / pm2-runner。
 *
 * 流程：
 *   1. 从 handoff payload 中读取 workflowId + currentStepId
 *   2. 解析 workflow 模板，找到当前 step
 *   3. 执行 step 的 gates（constitution-check 等）
 *   4. 调用对应 adapter 的 resolve 获取 agent 配置
 *   5. 完成后按 step.handoffTargets 创建下游 handoff
 */

import type { HandoffTaskRunner } from '../runner/watcher.js';
import { createHandoff } from '../store/handoff-store.js';
import { publishHandoffEvent } from '../bus/team-events-bus.js';
import { resolveWorkflow, resolveRoleAdapter } from './workflow-resolver.js';

export function isWorkflowDrivenEnabled(): boolean {
  return globalThis.process?.env['OPENAWORK_TEAM_WORKFLOW_DRIVEN'] === '1';
}

export function createWorkflowDrivenRunner(): HandoffTaskRunner {
  return async (input) => {
    if (input.signal.aborted) return;
    if (!isWorkflowDrivenEnabled()) return;

    const payload = input.handoff.payload as Record<string, unknown> | null;
    const workflowId = (payload?.['workflowId'] as string) ?? null;
    const currentStepId = (payload?.['stepId'] as string) ?? null;

    if (!workflowId || !currentStepId) return;

    // 1. 解析 workflow
    const workflow = resolveWorkflow({
      workflowId,
      userId: input.handoff.userId,
    });
    if (!workflow) {
      throw new Error(`Workflow "${workflowId}" 未找到`);
    }

    // 2. 找到当前 step
    const currentStep = workflow.steps.find((s) => s.id === currentStepId);
    if (!currentStep) {
      throw new Error(`Step "${currentStepId}" 不存在于 workflow "${workflowId}"`);
    }

    // 3. 解析 adapter
    const adapter = resolveRoleAdapter(currentStep.roleLayer);
    const resolution = adapter?.resolve({
      userId: input.handoff.userId,
      workflowId,
      stepId: currentStepId,
    });

    // 4. 如果是 terminal step，不创建下游 handoff
    if (currentStep.terminal) {
      return;
    }

    // 5. 按 handoffTargets 创建下游 handoff
    for (const targetStepId of currentStep.handoffTargets) {
      const targetStep = workflow.steps.find((s) => s.id === targetStepId);
      if (!targetStep) continue;

      const handoff = createHandoff({
        userId: input.handoff.userId,
        fromSessionId: input.toSessionId,
        fromRoleLayer: currentStep.roleLayer,
        toRoleLayer: targetStep.roleLayer,
        payload: {
          workflowId,
          stepId: targetStepId,
          parentStepId: currentStepId,
          toolsets: targetStep.toolsets,
          promptTemplate: targetStep.promptTemplate,
          ...(resolution ? { adapterResolution: resolution } : {}),
        },
      });
      publishHandoffEvent({ type: 'handoff.created', record: handoff });
    }
  };
}
