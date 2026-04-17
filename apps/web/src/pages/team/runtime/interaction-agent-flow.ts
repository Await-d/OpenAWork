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
  recommendedRole?: string;
  rewrittenIntent: string;
  sourceIntent: string;
  status: 'completed';
}

export interface InteractionAgentRewriteRequest {
  intent: string;
  context?: string;
}

export interface InteractionAgentRewriteResponse {
  createdAt: number;
  recommendedNextStep: string;
  recommendedRole: string;
  rewrittenIntent: string;
  sourceIntent: string;
  status: 'completed';
}

function buildFallbackArtifact(userIntent: string): InteractionAgentRewriteArtifact {
  const normalizedIntent = userIntent.trim();
  const rewrittenIntent = `请围绕"${normalizedIntent}"继续拆解团队任务`;

  return {
    createdAt: Date.now(),
    phaseMessages: {
      started: normalizedIntent,
      processing: 'LLM 不可用，使用本地改写。',
      completed: `已完成本地改写：${rewrittenIntent}。`,
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

async function requestInteractionAgentRewrite(
  input: InteractionAgentRewriteRequest,
  gatewayUrl: string,
  token: string,
): Promise<InteractionAgentRewriteResponse | null> {
  try {
    const response = await fetch(`${gatewayUrl}/team/interaction-agent/rewrite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as InteractionAgentRewriteResponse;
  } catch {
    return null;
  }
}

export async function submitInteractionAgentFlow(input: {
  submitMessage: (message: CreateTeamMessageInput) => Promise<boolean>;
  userIntent: string;
  context?: string;
  gatewayUrl?: string;
  token?: string;
}): Promise<InteractionAgentRewriteArtifact | null> {
  const normalizedIntent = input.userIntent.trim();
  if (!normalizedIntent) {
    return null;
  }

  const started = await input.submitMessage(
    buildInteractionAgentMessage('started', normalizedIntent),
  );
  if (!started) {
    return null;
  }

  const processing = await input.submitMessage(
    buildInteractionAgentMessage(
      'processing',
      '已接收该请求，正在由 interaction-agent 进行 LLM 驱动的需求改写…',
    ),
  );
  if (!processing) {
    return null;
  }

  let artifact: InteractionAgentRewriteArtifact;

  if (input.gatewayUrl && input.token) {
    const llmResult = await requestInteractionAgentRewrite(
      { intent: normalizedIntent, context: input.context },
      input.gatewayUrl,
      input.token,
    );

    if (llmResult) {
      artifact = {
        createdAt: llmResult.createdAt,
        phaseMessages: {
          started: normalizedIntent,
          processing: 'LLM 正在改写需求…',
          completed: `已完成 LLM 改写：${llmResult.rewrittenIntent}`,
        },
        recommendedNextStep: llmResult.recommendedNextStep,
        recommendedRole: llmResult.recommendedRole,
        rewrittenIntent: llmResult.rewrittenIntent,
        sourceIntent: normalizedIntent,
        status: 'completed',
      };
    } else {
      artifact = buildFallbackArtifact(normalizedIntent);
    }
  } else {
    artifact = buildFallbackArtifact(normalizedIntent);
  }

  const completed = await input.submitMessage(
    buildInteractionAgentMessage('completed', artifact.phaseMessages.completed),
  );

  return completed ? artifact : null;
}
