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
