import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  sqliteGet: () => undefined,
  sqliteRun: () => undefined,
}));

vi.mock('../routes/stream-cancellation.js', () => ({
  getAnyInFlightStreamRequestForSession: () => undefined,
}));

import { buildAutoResumeMessage } from '../task-parent-auto-resume.js';

describe('task parent auto resume', () => {
  it('caps aggregated synthetic resume messages below the stream request limit', () => {
    const longResult = '子代理长结果。'.repeat(600);
    const items: Parameters<typeof buildAutoResumeMessage>[0] = Array.from(
      { length: 24 },
      (_, index) => ({
        assignedAgent: `agent-${index + 1}`,
        childSessionId: `child-${index + 1}`,
        parentSessionId: 'parent-1',
        requestData: {
          clientRequestId: `parent-req-${index + 1}`,
          message: '请继续父会话',
          model: 'gpt-4o',
        },
        result: longResult,
        status: 'done' as const,
        taskId: `task-${index + 1}`,
        taskTitle: `任务 ${index + 1}`,
        userId: 'user-1',
      }),
    );

    const message = buildAutoResumeMessage(items);

    expect(message.length).toBeLessThanOrEqual(30000);
    expect(message).toContain('以下是后台子代理已完成后自动回流到主对话的结果');
    expect(message).toContain('其余');
    expect(message).toContain('已省略，请按需进入对应子会话查看详情。');
  });
});
