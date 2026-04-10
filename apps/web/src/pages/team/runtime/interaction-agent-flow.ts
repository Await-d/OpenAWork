import type { CreateTeamMessageInput } from '@openAwork/web-client';

type InteractionAgentPhase = 'processing' | 'started';

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

  return {
    content: `【interaction-agent/处理中】${content.trim()}`,
    type: 'update',
  };
}

export async function submitInteractionAgentFlow(input: {
  submitMessage: (message: CreateTeamMessageInput) => Promise<boolean>;
  userIntent: string;
}): Promise<boolean> {
  const normalizedIntent = input.userIntent.trim();
  if (!normalizedIntent) {
    return false;
  }

  const started = await input.submitMessage(
    buildInteractionAgentMessage('started', normalizedIntent),
  );
  if (!started) {
    return false;
  }

  return input.submitMessage(
    buildInteractionAgentMessage('processing', '已接收该请求，正在整理下一步动作。'),
  );
}
