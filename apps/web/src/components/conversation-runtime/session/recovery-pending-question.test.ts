import { describe, expect, it } from 'vitest';
import { getRecoveryPendingInteractions } from './recovery-read-model.js';

/**
 * recovery 快照路径的多选标记回归。
 *
 * 网关把问题列表按原始 JSON 透传，多选标记的字段名是工具入参里的 `multiSelect`，
 * 而前端模型读的是 `multiple`。`listPending`（流式路径）与这里（刷新 / 切会话快照
 * 路径）是两条独立入口，必须共用同一套归一化——只修其中一条，就会出现
 * 「刚问的时候是多选、刷新后又变回单选」。
 */
function buildQuestionRequest(questions: unknown[]): unknown {
  return {
    createdAt: '2026-10-18T07:14:29.000Z',
    questions,
    requestId: 'question-multi',
    sessionId: 'session-1',
    status: 'pending',
    title: '清理范围',
    toolName: 'AskUserQuestion',
  };
}

describe('getRecoveryPendingInteractions 的多选归一化', () => {
  it('把 multiSelect 归一化成 multiple（快照里的原始字段名）', () => {
    const interactions = getRecoveryPendingInteractions({
      pendingQuestions: [
        buildQuestionRequest([
          {
            header: '清理范围',
            multiSelect: true,
            options: [
              { description: '最推荐', label: '清空回收站（19G）' },
              { description: '安全', label: '压缩系统日志' },
            ],
            question: '请选择要立即清理的项目（可多选）',
          },
        ]),
      ],
    });

    expect(interactions.pendingQuestions).toHaveLength(1);
    expect(interactions.pendingQuestions[0]?.questions[0]?.multiple).toBe(true);
    expect(interactions.pendingQuestions[0]?.questions[0]?.options).toHaveLength(2);
  });

  it('未声明多选的问题保持单选语义', () => {
    const interactions = getRecoveryPendingInteractions({
      pendingQuestions: [
        buildQuestionRequest([
          {
            header: '回收站',
            options: [{ description: '删', label: '删除' }],
            question: '要删除吗？',
          },
        ]),
      ],
    });

    expect(interactions.pendingQuestions[0]?.questions[0]?.multiple).toBeUndefined();
  });

  it('session 内嵌的 fallback 问题列表同样被归一化', () => {
    const interactions = getRecoveryPendingInteractions({
      session: {
        pendingQuestions: [
          buildQuestionRequest([{ header: 'H', multiSelect: true, options: [], question: 'Q' }]),
        ],
      },
    });

    expect(interactions.pendingQuestions[0]?.questions[0]?.multiple).toBe(true);
  });

  it('结构异常的条目被剔除，不会击穿渲染', () => {
    const interactions = getRecoveryPendingInteractions({
      pendingQuestions: [null, 'not-an-object', { requestId: 'x' }],
    });

    expect(interactions.pendingQuestions).toEqual([]);
    expect(interactions.pendingQuestion).toBeNull();
  });
});
