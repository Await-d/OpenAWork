import type { CreateTeamMessageInput } from '@openAwork/web-client';
import type { InteractionAgentRewriteArtifact } from './interaction-agent-flow.js';

// ─── Types ───

export interface LeaderDispatchedTask {
  assigneeRole: string;
  assigneeAgentId: string;
  priority: 'low' | 'medium' | 'high';
  taskId: string;
  title: string;
}

export interface LeaderDispatchResult {
  dispatchedTasks: LeaderDispatchedTask[];
  leaderAnalysis: string;
  status: 'completed';
}

export interface LeaderDispatchArtifact {
  dispatchedTasks: LeaderDispatchedTask[];
  leaderAnalysis: string;
  phaseMessages: {
    started: string;
    processing: string;
    completed: string;
  };
  sourceRewrittenIntent: string;
  status: 'completed';
}

export interface TeamRosterMember {
  role: string;
  agentId: string;
  agentLabel: string;
  capability?: string;
}

// ─── Message Builder ───

type LeaderPhase = 'completed' | 'processing' | 'started';

export function buildTeamLeaderMessage(
  phase: LeaderPhase,
  content: string,
): CreateTeamMessageInput {
  if (phase === 'started') {
    return {
      content: `【team-leader/接收】${content.trim()}`,
      type: 'question',
    };
  }

  if (phase === 'completed') {
    return {
      content: `【team-leader/完成】${content.trim()}`,
      type: 'result',
    };
  }

  return {
    content: `【team-leader/分析中】${content.trim()}`,
    type: 'update',
  };
}

// ─── API Call ───

async function requestLeaderDispatch(
  artifact: InteractionAgentRewriteArtifact,
  gatewayUrl: string,
  token: string,
  context?: string,
  teamRoster?: TeamRosterMember[],
): Promise<LeaderDispatchResult | null> {
  try {
    const response = await fetch(`${gatewayUrl}/team/leader/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        context,
        recommendedRole: artifact.recommendedRole,
        rewrittenIntent: artifact.rewrittenIntent,
        sourceIntent: artifact.sourceIntent,
        teamRoster: teamRoster ?? [],
      }),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as LeaderDispatchResult;
  } catch {
    return null;
  }
}

// ─── Fallback (no LLM) ───

function buildFallbackDispatch(artifact: InteractionAgentRewriteArtifact): LeaderDispatchArtifact {
  return {
    dispatchedTasks: [
      {
        assigneeRole: artifact.recommendedRole ?? 'planner',
        assigneeAgentId: artifact.recommendedRole ?? 'oracle',
        priority: 'medium',
        taskId: '__fallback__',
        title: artifact.rewrittenIntent,
      },
    ],
    leaderAnalysis: 'LLM 不可用，使用本地回退分派。将改写结果作为单一任务分配给推荐角色。',
    phaseMessages: {
      started: `已接收 interaction-agent 改写结果，准备分派…`,
      processing: 'LLM 不可用，使用本地回退分派。',
      completed: `已回退分派 1 个任务给 ${artifact.recommendedRole ?? 'planner'}。`,
    },
    sourceRewrittenIntent: artifact.rewrittenIntent,
    status: 'completed',
  };
}

// ─── Main Flow ───

export async function submitTeamLeaderDispatchFlow(input: {
  submitMessage: (message: CreateTeamMessageInput) => Promise<boolean>;
  rewriteArtifact: InteractionAgentRewriteArtifact;
  context?: string;
  gatewayUrl?: string;
  token?: string;
  teamRoster?: TeamRosterMember[];
}): Promise<LeaderDispatchArtifact | null> {
  const { rewriteArtifact } = input;
  if (!rewriteArtifact.rewrittenIntent.trim()) {
    return null;
  }

  // Phase 1: Announce receipt
  const started = await input.submitMessage(
    buildTeamLeaderMessage(
      'started',
      `已接收 interaction-agent 改写结果：「${rewriteArtifact.rewrittenIntent}」，正在交由 team-leader 进行任务拆解与分派…`,
    ),
  );
  if (!started) {
    return null;
  }

  // Phase 2: Processing
  const processing = await input.submitMessage(
    buildTeamLeaderMessage('processing', 'team-leader 正在分析意图并拆解为团队任务…'),
  );
  if (!processing) {
    return null;
  }

  // Phase 3: Call LLM or fallback
  let artifact: LeaderDispatchArtifact;

  if (input.gatewayUrl && input.token) {
    const result = await requestLeaderDispatch(
      rewriteArtifact,
      input.gatewayUrl,
      input.token,
      input.context,
      input.teamRoster,
    );

    if (result) {
      const taskSummary = result.dispatchedTasks
        .map((t) => `${t.assigneeRole}: ${t.title}`)
        .join('；');
      artifact = {
        dispatchedTasks: result.dispatchedTasks,
        leaderAnalysis: result.leaderAnalysis,
        phaseMessages: {
          started: `已接收改写结果，准备分派…`,
          processing: 'team-leader 正在分析意图并拆解为团队任务…',
          completed: `team-leader 已完成分析，分派 ${result.dispatchedTasks.length} 个任务：${taskSummary}`,
        },
        sourceRewrittenIntent: rewriteArtifact.rewrittenIntent,
        status: 'completed',
      };
    } else {
      artifact = buildFallbackDispatch(rewriteArtifact);
    }
  } else {
    artifact = buildFallbackDispatch(rewriteArtifact);
  }

  // Phase 4: Announce completion
  const completed = await input.submitMessage(
    buildTeamLeaderMessage('completed', artifact.phaseMessages.completed),
  );

  return completed ? artifact : null;
}
