/**
 * 回归：待处理问题请求的 `multiSelect` → `multiple` 归一化。
 *
 * 工具入参里的字段名是 `multiSelect`（`AskUserQuestion` 的 `questions[]`），而前端模型
 * 用 `multiple`。归一化漏掉任何一条读取路径，对应的写回都会把题目降级成单选——用户
 * 勾第二项时第一项被顶掉，提交后只回显一项。
 */
import { describe, expect, it } from 'vitest';

import {
  normalizePendingQuestionRequest,
  normalizePendingQuestionRequests,
} from './question-normalization.js';

function requestWithQuestions(questions: unknown[]): unknown {
  return {
    createdAt: '2026-10-18T07:14:29.000Z',
    questions,
    requestId: 'question-1',
    sessionId: 'session-1',
    status: 'pending',
    title: '清理范围',
    toolName: 'AskUserQuestion',
  };
}

describe('normalizePendingQuestionRequest', () => {
  it('把 multiSelect 归一化成 multiple', () => {
    const result = normalizePendingQuestionRequest(
      requestWithQuestions([
        {
          header: '清理范围',
          multiSelect: true,
          options: [{ label: '清空回收站', description: '最推荐' }],
          question: '请选择要立即清理的项目（可多选）',
        },
      ]),
    );

    expect(result?.questions[0]?.multiple).toBe(true);
  });

  it('兼容已经是 multiple 的数据', () => {
    const result = normalizePendingQuestionRequest(
      requestWithQuestions([{ header: 'H', multiple: true, options: [], question: 'Q' }]),
    );

    expect(result?.questions[0]?.multiple).toBe(true);
  });

  it('兼容字符串形式的布尔值', () => {
    const result = normalizePendingQuestionRequest(
      requestWithQuestions([
        { header: 'A', multiSelect: 'true', options: [], question: 'Q' },
        { header: 'B', multiSelect: 'false', options: [], question: 'Q' },
      ]),
    );

    expect(result?.questions[0]?.multiple).toBe(true);
    expect(result?.questions[1]?.multiple).toBe(false);
  });

  it('幂等：已归一化的结果再归一化一次不变', () => {
    // 归一化被挂在多条读取路径上，同一份数据可能被处理多次（例如 `listPending` 的
    // 结果又被 recovery 覆盖、再被 3s 轮询覆盖）。任何一次改写都必须稳定，
    // 否则 `preserveEqualList` 的深比较会持续判定「变了」而反复替换引用。
    const once = normalizePendingQuestionRequest(
      requestWithQuestions([
        { header: 'A', multiSelect: true, options: [], question: 'Q' },
        { header: 'B', options: [], question: 'Q2' },
      ]),
    );
    const twice = normalizePendingQuestionRequest(once);

    expect(twice).toEqual(once);
  });

  it('未声明多选时保持 undefined，不退化成 false', () => {
    // 保住「没声明」与「显式声明单选」的区分；调用方一律按 `=== true` 判定，
    // 因此两者渲染行为一致，但排查时能看出模型到底有没有给过这个字段。
    const result = normalizePendingQuestionRequest(
      requestWithQuestions([{ header: 'H', options: [], question: 'Q' }]),
    );

    expect(result?.questions[0]?.multiple).toBeUndefined();
    expect('multiple' in (result?.questions[0] ?? {})).toBe(false);
  });

  it('保留 options / nodeId / round', () => {
    const result = normalizePendingQuestionRequest(
      requestWithQuestions([
        {
          header: 'H',
          multiSelect: true,
          nodeId: 'goal',
          round: 2,
          options: [{ label: 'A', description: 'a', preview: '<b>a</b>', recommended: true }],
          question: 'Q',
        },
      ]),
    );

    expect(result?.questions[0]?.nodeId).toBe('goal');
    expect(result?.questions[0]?.round).toBe(2);
    expect(result?.questions[0]?.options).toEqual([
      { label: 'A', description: 'a', preview: '<b>a</b>', recommended: true },
    ]);
  });

  it('剔除结构异常的问题项', () => {
    const result = normalizePendingQuestionRequest(
      requestWithQuestions([
        null,
        'not-an-object',
        { header: 'H', multiSelect: true, options: [], question: 'Q' },
      ]),
    );

    expect(result?.questions).toHaveLength(1);
    expect(result?.questions[0]?.multiple).toBe(true);
  });

  it('非对象输入返回 null', () => {
    expect(normalizePendingQuestionRequest(null)).toBeNull();
    expect(normalizePendingQuestionRequest('{}')).toBeNull();
    expect(normalizePendingQuestionRequest([])).toBeNull();
  });

  it('status 非法时回落到 pending（与本模块既有的容错口径一致）', () => {
    const result = normalizePendingQuestionRequest({
      ...(requestWithQuestions([]) as Record<string, unknown>),
      status: 'weird',
    });

    expect(result?.status).toBe('pending');
  });
});

describe('normalizePendingQuestionRequests', () => {
  it('批量归一化并剔除无效条目', () => {
    const result = normalizePendingQuestionRequests([
      requestWithQuestions([{ header: 'H', multiSelect: true, options: [], question: 'Q' }]),
      null,
      requestWithQuestions([{ header: 'H2', multiSelect: true, options: [], question: 'Q2' }]),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.questions[0]?.multiple).toBe(true);
  });

  it('非数组输入返回空数组', () => {
    expect(normalizePendingQuestionRequests(undefined)).toEqual([]);
    expect(normalizePendingQuestionRequests(null)).toEqual([]);
    expect(normalizePendingQuestionRequests({ requests: [] })).toEqual([]);
  });
});
