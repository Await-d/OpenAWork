import { describe, expect, it } from 'vitest';
import { toPublicSessionResponse } from '../../routes/session-route-helpers.js';

const BASE_SESSION = {
  id: 'session-1',
  state_status: 'running',
  metadata_json: '{}',
  title: '会话',
  created_at: '2026-07-06T00:00:00.000Z',
  updated_at: '2026-07-06T00:00:00.000Z',
};

describe('session workflow runtime read model', () => {
  it('旧会话没有新增 metadata 时返回空运行状态', () => {
    const response = toPublicSessionResponse(BASE_SESSION, []);

    expect(response.workflowRuntime).toEqual({
      mode: 'normal',
      evidence: {
        artifactRefs: [],
        status: 'none',
      },
    });
  });

  it('从 start-work metadata 构造计划执行状态', () => {
    const response = toPublicSessionResponse(
      {
        ...BASE_SESSION,
        metadata_json: JSON.stringify({
          activeWorkflowPlanPath: '.agentdocs/workflow/260706-lazycodex-native-workflow.md',
          activeWorkflowPlanProgress: '1/8',
          activeWorkflowPlanTitle: 'LazyCodex/OmO 原生化接入工作流',
          activeWorkflowWorktreePath: '/workspace/OpenAWork',
          requestedWorkflowWorktreePath: '/workspace/OpenAWork',
        }),
      },
      [],
    );

    expect(response.workflowRuntime).toMatchObject({
      mode: 'execution',
      activePlan: {
        path: '.agentdocs/workflow/260706-lazycodex-native-workflow.md',
        progress: '1/8',
        title: 'LazyCodex/OmO 原生化接入工作流',
        worktreePath: '/workspace/OpenAWork',
      },
    });
  });

  it('从 ULW metadata 构造验证等待状态', () => {
    const response = toPublicSessionResponse(
      {
        ...BASE_SESSION,
        metadata_json: JSON.stringify({
          activeLoopKind: 'ulw',
          activeLoopTaskDescription: '完成工作流',
          activeLoopTaskId: 'task-ulw',
          ulwLoopCompletionPromise: 'DONE',
          ulwLoopStartedAt: 1783300000000,
          ulwLoopStrategy: 'continue',
          ulwLoopVerificationRequired: true,
          ulwVerificationPendingTaskId: 'task-ulw',
        }),
      },
      [],
    );

    expect(response.workflowRuntime).toMatchObject({
      mode: 'ulw',
      activeLoop: {
        completionPromise: 'DONE',
        kind: 'ulw',
        strategy: 'continue',
        taskDescription: '完成工作流',
        taskId: 'task-ulw',
        verificationRequired: true,
        verificationStatus: 'pending',
      },
    });
  });

  it('来源会话（渠道 / 定时任务）的脏 clarify 不投影成「规划中」', () => {
    // dialogueMode 对来源会话没有语义：脏值只影响状态投影，这里锁住它不生效；
    // 真实的工作流进度（activePlan / activeLoop）与对话模式无关，必须照常投影。
    const polluted = toPublicSessionResponse(
      {
        ...BASE_SESSION,
        metadata_json: JSON.stringify({ source: 'channel', dialogueMode: 'clarify' }),
      },
      [],
    );
    expect(polluted.workflowRuntime.mode).toBe('normal');

    const withPlan = toPublicSessionResponse(
      {
        ...BASE_SESSION,
        metadata_json: JSON.stringify({
          source: 'channel',
          dialogueMode: 'clarify',
          activeWorkflowPlanPath: '.agentdocs/workflow/plan.md',
        }),
      },
      [],
    );
    expect(withPlan.workflowRuntime.mode).toBe('execution');
  });

  it('从 metadata 暴露已记录的工作流证据 artifact', () => {
    const response = toPublicSessionResponse(
      {
        ...BASE_SESSION,
        metadata_json: JSON.stringify({
          workflowRuntimeEvidenceArtifactRefs: ['artifact-pending', 'artifact-final'],
          workflowRuntimeEvidenceStatus: 'available',
        }),
      },
      [],
    );

    expect(response.workflowRuntime.evidence).toEqual({
      artifactRefs: ['artifact-pending', 'artifact-final'],
      status: 'available',
    });
  });
});
