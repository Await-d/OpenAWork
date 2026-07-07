// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowRuntimeState } from '@openAwork/shared';
import type { SessionTask } from '@openAwork/web-client';
import { WorkflowRuntimeStatusStrip } from './WorkflowRuntimeStatusStrip.js';

afterEach(() => {
  cleanup();
});

function createRuntime(overrides: Partial<WorkflowRuntimeState>): WorkflowRuntimeState {
  return {
    evidence: { artifactRefs: [], status: 'none' },
    mode: 'normal',
    ...overrides,
  };
}

function createTask(metadata?: Record<string, unknown>): SessionTask {
  return {
    blockedBy: [],
    completedSubtaskCount: 0,
    createdAt: 1,
    depth: 0,
    id: 'task-1',
    metadata,
    priority: 'medium',
    readySubtaskCount: 0,
    status: 'running',
    subtaskCount: 0,
    tags: [],
    title: '实现功能',
    unmetDependencyCount: 0,
    updatedAt: 1,
  };
}

describe('WorkflowRuntimeStatusStrip', () => {
  it('普通对话且没有 gate 时不渲染状态条', () => {
    render(<WorkflowRuntimeStatusStrip runtime={null} tasks={[]} />);

    expect(screen.queryByLabelText('工作流运行状态')).toBeNull();
  });

  it('执行计划存在时展示计划进度和证据数量', () => {
    const runtime = createRuntime({
      activePlan: {
        path: '.agentdocs/workflow/260706-lazycodex-native-workflow.md',
        progress: 'T6/8',
        title: 'LazyCodex 原生工作流',
      },
      evidence: { artifactRefs: ['artifact-1', 'artifact-2'], status: 'available' },
      mode: 'execution',
    });

    render(<WorkflowRuntimeStatusStrip runtime={runtime} tasks={[]} />);

    expect(screen.getByText('执行中')).toBeTruthy();
    expect(screen.getByText('LazyCodex 原生工作流 · T6/8')).toBeTruthy();
    expect(screen.getByText('2 个 artifact')).toBeTruthy();
  });

  it('ULW 循环等待验证时展示验证状态和完成承诺', () => {
    const runtime = createRuntime({
      activeLoop: {
        completionPromise: '完成后提交证据包',
        kind: 'ulw',
        taskId: 'T6',
        verificationRequired: true,
        verificationStatus: 'pending',
      },
      evidence: { artifactRefs: [], status: 'pending' },
      mode: 'ulw',
    });

    render(<WorkflowRuntimeStatusStrip runtime={runtime} tasks={[]} />);

    expect(screen.getByText('ULW 循环')).toBeTruthy();
    expect(screen.getByText('ULW · 等待验证')).toBeTruthy();
    expect(screen.getByText('完成后提交证据包')).toBeTruthy();
    expect(screen.getByText('生成中')).toBeTruthy();
  });

  it('start-work gate 存在时即使没有 runtime 也展示 reviewer 汇总', () => {
    render(
      <WorkflowRuntimeStatusStrip
        runtime={null}
        tasks={[
          createTask({
            startWorkGate: {
              completionBlocked: true,
              executorClaimStatus: 'submitted',
              verifierVerdict: 'pending',
            },
          }),
          createTask({
            startWorkGate: {
              completionBlocked: false,
              executorClaimStatus: 'submitted',
              verifierVerdict: 'confirmed',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('执行门禁')).toBeTruthy();
    expect(screen.getByText('2 已声明 / 1 待审 / 1 确认 / 1 阻塞')).toBeTruthy();
  });
});
