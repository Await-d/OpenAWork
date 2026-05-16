/**
 * 260515-team-phase-c / 260516-team-phase-d · Watcher → Runner 分发
 *
 * 根据 handoff 的 toRoleLayer 分发到对应的 runner：
 *   - pm1 → runArtifactChain（Phase C）
 *   - pm2 → pm2-runner（Phase D）
 *   - 其他 → noop stub（Phase E 接入）
 */

import type { HandoffTaskRunner } from './watcher.js';
import { isHandoffModeEnabled } from './feature-flags.js';
import { runArtifactChain } from './artifact-chain.js';
import { resolveAuxiliaryLlmConfig } from '../auxiliary-llm-config.js';

/**
 * 创建一个 task runner，根据 toRoleLayer 分发。
 */
export function createPhaseCAwareRunner(): HandoffTaskRunner {
  return async (input) => {
    if (input.signal.aborted) return;
    if (!isHandoffModeEnabled()) return;

    if (input.handoff.toRoleLayer === 'pm1') {
      await runPm1(input);
    } else if (input.handoff.toRoleLayer === 'pm2') {
      const { createPm2Runner } = await import('./pm2-runner.js');
      const pm2Runner = createPm2Runner();
      await pm2Runner(input);
    }
    // executor / reviewer → Phase E 接入真正 LLM 执行
  };
}

// ─── PM1 Runner（Phase C artifact chain） ───────────────────────────────────

async function runPm1(input: Parameters<HandoffTaskRunner>[0]): Promise<void> {
  const payload = input.handoff.payload as Record<string, unknown> | null;
  const rewrittenIntent =
    typeof payload?.['rewrittenIntent'] === 'string'
      ? payload['rewrittenIntent']
      : typeof payload?.['intent'] === 'string'
        ? payload['intent']
        : '未提供意图';
  const sourceIntent =
    typeof payload?.['sourceIntent'] === 'string' ? payload['sourceIntent'] : rewrittenIntent;
  const teamWorkspaceId =
    typeof payload?.['teamWorkspaceId'] === 'string' ? payload['teamWorkspaceId'] : null;

  const llmConfig = await resolveAuxiliaryLlmConfig(input.handoff.userId);
  if (!llmConfig) {
    throw new Error('PM1 artifact chain: 无可用 LLM 配置（auxiliary-llm-config 未设置）');
  }

  const { requestWorkflowLlmCompletion } = await import('../routes/workflow-llm.js');
  const callLlm = async (systemPrompt: string, userMessage: string): Promise<string> => {
    if (input.signal.aborted) {
      throw new Error('aborted');
    }
    return requestWorkflowLlmCompletion({
      apiBaseUrl: llmConfig.apiBaseUrl,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
      ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
      prompt: `${systemPrompt}\n\n---\n\n${userMessage}`,
      temperature: 0.3,
    });
  };

  await runArtifactChain({
    userId: input.handoff.userId,
    sessionId: input.toSessionId,
    handoff: input.handoff,
    sourceIntent,
    rewrittenIntent,
    teamWorkspaceId,
    callLlm,
  });
}
