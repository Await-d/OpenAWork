import { describe, expect, it } from 'vitest';
import {
  buildQuestionRequestTitle,
  createQuestionInteractionRecord,
  formatAnsweredQuestionOutput,
  questionToolDefinition,
  type QuestionToolInput,
} from '../../tools/question-tools.js';

const inputSchema = questionToolDefinition.inputSchema;

function firstQuestion(input: QuestionToolInput) {
  const parsed = inputSchema.parse(input);
  return parsed.questions[0]!;
}

describe('question tool schema', () => {
  it('接受带 recommended / nodeId / round 的输入', () => {
    const question = firstQuestion({
      questions: [
        {
          question: '目标是什么？',
          header: '目标',
          nodeId: 'goal',
          round: 0,
          options: [
            { label: '改单文件', description: '范围清晰', recommended: true },
            { label: '跨模块', description: '涉及多模块' },
          ],
        },
      ],
    });

    expect(question.nodeId).toBe('goal');
    expect(question.round).toBe(0);
    expect(question.options[0]?.recommended).toBe(true);
    expect(question.options[1]?.recommended).toBeUndefined();
  });

  it('向后兼容：接受不含新字段的历史输入', () => {
    const parsed = inputSchema.parse({
      questions: [
        {
          question: '目标是什么？',
          header: '目标',
          options: [{ label: 'A', description: 'a' }],
        },
      ],
    });

    expect(parsed.questions[0]?.nodeId).toBeUndefined();
    expect(parsed.questions[0]?.round).toBeUndefined();
    expect(parsed.questions[0]?.options[0]?.recommended).toBeUndefined();
  });

  it('保留既有约束（multiSelect / preview 仍可用）', () => {
    const question = firstQuestion({
      questions: [
        {
          question: 'q',
          header: 'h',
          multiSelect: true,
          options: [{ label: 'A', description: 'a', preview: 'p' }],
        },
      ],
    });

    expect(question.multiSelect).toBe(true);
    expect(question.options[0]?.preview).toBe('p');
  });

  it('拒绝空 questions / 空 options', () => {
    expect(inputSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(
      inputSchema.safeParse({ questions: [{ question: 'q', header: 'h', options: [] }] }).success,
    ).toBe(false);
  });

  it('拒绝缺少 description 的选项（既有 min(1) 约束）', () => {
    expect(
      inputSchema.safeParse({
        questions: [{ question: 'q', header: 'h', options: [{ label: 'A' }] }],
      }).success,
    ).toBe(false);
  });

  it('拒绝非法 round（负数 / 非整数）与空 nodeId', () => {
    const base = { question: 'q', header: 'h', options: [{ label: 'A', description: 'a' }] };
    expect(inputSchema.safeParse({ questions: [{ ...base, round: -1 }] }).success).toBe(false);
    expect(inputSchema.safeParse({ questions: [{ ...base, round: 1.5 }] }).success).toBe(false);
    expect(inputSchema.safeParse({ questions: [{ ...base, nodeId: '' }] }).success).toBe(false);
  });

  it('拒绝非布尔的 recommended', () => {
    expect(
      inputSchema.safeParse({
        questions: [
          {
            question: 'q',
            header: 'h',
            options: [{ label: 'A', description: 'a', recommended: 'yes' }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('questionToolDefinition 元数据', () => {
  it('名称、超时与描述', () => {
    expect(questionToolDefinition.name).toBe('question');
    expect(questionToolDefinition.timeout).toBe(30000);
    expect(questionToolDefinition.description).toContain('recommended');
  });

  it('execute 必须走网关沙箱路径（直接调用即抛错）', async () => {
    await expect(
      questionToolDefinition.execute(
        {
          questions: [{ question: 'q', header: 'h', options: [{ label: 'A', description: 'a' }] }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/gateway-managed sandbox path/);
  });
});

describe('buildQuestionRequestTitle', () => {
  it('取第一条 header 并去除首尾空白', () => {
    expect(
      buildQuestionRequestTitle({
        questions: [
          { question: 'q', header: '  目标  ', options: [{ label: 'A', description: 'a' }] },
        ],
      }),
    ).toBe('目标');
  });

  it('header 全为空白时回落到 Question', () => {
    expect(
      buildQuestionRequestTitle({
        questions: [{ question: 'q', header: '   ', options: [{ label: 'A', description: 'a' }] }],
      }),
    ).toBe('Question');
  });

  it('questions 为空时回落到 Question', () => {
    expect(buildQuestionRequestTitle({ questions: [] })).toBe('Question');
  });
});

describe('formatAnsweredQuestionOutput', () => {
  const questions = [
    { question: '目标？', header: 'h', options: [{ label: 'A', description: 'a' }] },
    { question: '约束？', header: 'h', options: [{ label: 'B', description: 'b' }] },
  ];

  it('按 问题="答案" 逐行输出，多选用逗号连接', () => {
    expect(formatAnsweredQuestionOutput({ questions, answers: [['A', 'C'], ['B']] })).toBe(
      '目标？="A, C"\n约束？="B"',
    );
  });

  it('缺失答案的题输出空答案', () => {
    expect(formatAnsweredQuestionOutput({ questions, answers: [[]] })).toBe('目标？=""\n约束？=""');
  });
});

describe('createQuestionInteractionRecord', () => {
  const questions = [
    { question: '目标？', header: 'h', options: [{ label: 'A', description: 'a' }] },
  ];

  it('默认通道为 api，payload 携带题目', () => {
    const record = createQuestionInteractionRecord({
      interactionId: 'i1',
      runId: 'r1',
      status: 'pending',
      toolName: 'question',
      questions,
    });

    expect(record.type).toBe('question');
    expect(record.channel).toBe('api');
    expect(record.payload).toEqual({ toolName: 'question', questions });
    expect(record.answeredAt).toBeUndefined();
  });

  it('可选字段存在时被带入', () => {
    const record = createQuestionInteractionRecord({
      answers: [['A']],
      answeredAt: 123,
      channel: 'mailbox',
      interactionId: 'i1',
      runId: 'r1',
      status: 'answered',
      taskId: 't1',
      toolCallRef: 'call-1',
      toolName: 'question',
      questions,
    });

    expect(record.taskId).toBe('t1');
    expect(record.toolCallRef).toBe('call-1');
    expect(record.channel).toBe('mailbox');
    expect(record.answeredAt).toBe(123);
    expect(record.payload).toEqual({ toolName: 'question', questions, answers: [['A']] });
  });
});
