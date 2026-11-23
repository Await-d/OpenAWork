import { describe, expect, it } from 'vitest';
import { getSessionWorkflowRuntime } from './workflow-runtime.js';

describe('getSessionWorkflowRuntime', () => {
  it('优先返回网关 typed workflowRuntime 字段', () => {
    const runtime = getSessionWorkflowRuntime({
      metadata_json: '{}',
      workflowRuntime: {
        mode: 'execution',
        activePlan: {
          path: '.agentdocs/workflow/260706-lazycodex-native-workflow.md',
          progress: '1/8',
          title: 'LazyCodex/OmO 原生化接入工作流',
        },
        evidence: {
          artifactRefs: [],
          status: 'none',
        },
      },
    });

    expect(runtime.mode).toBe('execution');
    expect(runtime.activePlan?.path).toBe(
      '.agentdocs/workflow/260706-lazycodex-native-workflow.md',
    );
  });

  it('来源会话（渠道 / 定时任务）的脏 dialogueMode 不投影成「规划中」', () => {
    // 来源会话没有对话模式：脏 clarify 只影响状态投影，不得让它显示成 planning。
    expect(
      getSessionWorkflowRuntime({
        metadata_json: JSON.stringify({ source: 'channel', dialogueMode: 'clarify' }),
      }).mode,
    ).toBe('normal');
    expect(
      getSessionWorkflowRuntime({
        metadata_json: JSON.stringify({ source: 'cron', dialogueMode: 'clarify' }),
      }).mode,
    ).toBe('normal');

    // 真实进度（activePlan / activeLoop）与对话模式无关，必须照常投影。
    expect(
      getSessionWorkflowRuntime({
        metadata_json: JSON.stringify({
          source: 'channel',
          dialogueMode: 'clarify',
          activeWorkflowPlanPath: '.agentdocs/workflow/plan.md',
        }),
      }).mode,
    ).toBe('execution');

    // 普通会话不受影响：clarify 仍是 planning。
    expect(
      getSessionWorkflowRuntime({
        metadata_json: JSON.stringify({ dialogueMode: 'clarify' }),
      }).mode,
    ).toBe('planning');
  });

  it('旧 session 只有 metadata_json 时仍能构造空状态', () => {
    const runtime = getSessionWorkflowRuntime({
      metadata_json: '{"workingDirectory":"/workspace/demo"}',
    });

    expect(runtime).toEqual({
      mode: 'normal',
      evidence: {
        artifactRefs: [],
        status: 'none',
      },
    });
  });

  it('旧 session 的 ULW metadata 会被映射为验证中状态', () => {
    const runtime = getSessionWorkflowRuntime({
      metadata_json: JSON.stringify({
        activeLoopKind: 'ulw',
        activeLoopTaskId: 'task-ulw',
        ulwLoopCompletionPromise: 'DONE',
        ulwLoopVerificationRequired: true,
        ulwVerificationPendingTaskId: 'task-ulw',
      }),
    });

    expect(runtime).toMatchObject({
      mode: 'ulw',
      activeLoop: {
        completionPromise: 'DONE',
        kind: 'ulw',
        taskId: 'task-ulw',
        verificationRequired: true,
        verificationStatus: 'pending',
      },
    });
  });

  it('旧 session 的证据 metadata 会被映射为可用 artifact 列表', () => {
    const runtime = getSessionWorkflowRuntime({
      metadata_json: JSON.stringify({
        workflowRuntimeEvidenceArtifactRefs: ['artifact-pending', 'artifact-final'],
        workflowRuntimeEvidenceStatus: 'available',
      }),
    });

    expect(runtime.evidence).toEqual({
      artifactRefs: ['artifact-pending', 'artifact-final'],
      status: 'available',
    });
  });
});
