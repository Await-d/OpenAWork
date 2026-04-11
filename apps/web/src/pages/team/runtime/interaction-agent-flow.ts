import type { CreateTeamMessageInput } from '@openAwork/web-client';

type InteractionAgentPhase = 'completed' | 'processing' | 'started';

export interface InteractionAgentRewriteArtifact {
  createdAt: number;
  phaseMessages: {
    completed: string;
    processing: string;
    started: string;
  };
  recommendedNextStep: string;
  rewrittenIntent: string;
  sourceIntent: string;
  status: 'completed';
}

export function buildInteractionAgentRewriteArtifact(
  userIntent: string,
): InteractionAgentRewriteArtifact {
  const normalizedIntent = userIntent.trim();
  const rewrittenIntent = `请围绕“${normalizedIntent}”继续拆解团队任务`;

  return {
    createdAt: Date.now(),
    phaseMessages: {
      started: normalizedIntent,
      processing: '已接收该请求，正在整理下一步动作。',
      completed: `已完成初步改写：${rewrittenIntent}。`,
    },
    recommendedNextStep: '可将这条改写结果继续落到 Team 任务、共享运行跟进项或执行角色分工。',
    rewrittenIntent,
    sourceIntent: normalizedIntent,
    status: 'completed',
  };
}

export function buildInteractionAgentMessage(
  phase: InteractionAgentPhase,
  content: string,
): CreateTeamMessageInput {
  if (phase === 'started') {
    return {
      content: `【interaction-agent/发起】${content.trim()}`,
      type: 'question',
    };
  }

  if (phase === 'completed') {
    return {
      content: `【interaction-agent/完成】${content.trim()}`,
      type: 'result',
    };
  }

  return {
    content: `【interaction-agent/处理中】${content.trim()}`,
    type: 'update',
  };
}

export async function submitInteractionAgentFlow(input: {
  submitMessage: (message: CreateTeamMessageInput) => Promise<boolean>;
  userIntent: string;
}): Promise<InteractionAgentRewriteArtifact | null> {
  const normalizedIntent = input.userIntent.trim();
  if (!normalizedIntent) {
    return null;
  }

  const artifact = buildInteractionAgentRewriteArtifact(normalizedIntent);

  const started = await input.submitMessage(
    buildInteractionAgentMessage('started', artifact.phaseMessages.started),
  );
  if (!started) {
    return null;
  }

  const processing = await input.submitMessage(
    buildInteractionAgentMessage('processing', artifact.phaseMessages.processing),
  );
  if (!processing) {
    return null;
  }

  const completed = await input.submitMessage(
    buildInteractionAgentMessage('completed', artifact.phaseMessages.completed),
  );

  return completed ? artifact : null;
}
