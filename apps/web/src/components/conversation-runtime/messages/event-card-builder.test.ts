/**
 * 共置测试：`event-card-builder.ts`。
 *
 * 该模块把流式 `RunEvent` 投影成可在消息列表里渲染的卡片 JSON：
 * 压缩事件走专用 GenerativeUI 卡片，权限/提问/任务/子会话/审计走通用
 * `assistant_event` 卡片。分类器（`classifyAssistantEventKind`）与状态/标签
 * 映射都是模块私有函数，这里通过公开的 `createAssistantEventContent` /
 * `createCommandCardContent` 间接固定它们的输出。
 */
import { describe, expect, it } from 'vitest';
import { createAssistantEventContent, createCommandCardContent } from './event-card-builder.js';
import { parseAssistantEventContent } from './card-codec.js';
import type { AssistantEventPayload } from './message-model.js';
import type { RunEvent } from '@openAwork/shared';

// 注意：`parseAssistantEventContent`（card-codec）当前不接受 `kind: 'question'`
// —— 它只白名单了 agent / audit / compaction / mcp / permission / skill / task /
// tool。所以这里直接读 JSON payload，并在专门用例里记录该不识别行为。
function requireContent(content: string | null): string {
  if (content === null) {
    throw new Error('期望生成卡片内容，实际为 null');
  }
  return content;
}

function parseEventCardPayload(content: string | null): AssistantEventPayload {
  const parsed = JSON.parse(requireContent(content)) as {
    payload?: AssistantEventPayload;
    type?: string;
  };
  if (parsed.type !== 'assistant_event' || !parsed.payload) {
    throw new Error(`期望生成 assistant_event 卡片，实际内容: ${content}`);
  }
  return parsed.payload;
}

function parseCard(content: string | null): Record<string, unknown> {
  return JSON.parse(requireContent(content)) as Record<string, unknown>;
}

describe('createAssistantEventContent · compaction', () => {
  it('compaction 事件生成专用压缩卡片', () => {
    const content = createAssistantEventContent({
      type: 'compaction',
      summary: '已压缩较早轮次。',
      trigger: 'manual',
      phase: 'completed',
    });

    expect(parseCard(content)).toEqual({
      type: 'compaction',
      payload: {
        title: 'compact',
        summary: '已压缩较早轮次。',
        trigger: 'manual',
        phase: 'completed',
      },
    });
  });

  it('摘要拼接条数与 cause 触发文案', () => {
    const content = createAssistantEventContent({
      type: 'compaction',
      summary: '保留关键上下文',
      trigger: 'automatic',
      phase: 'completed',
      cause: 'usage_overflow',
      compactedMessages: 4,
      representedMessages: 6,
    });

    expect(parseCard(content)).toMatchObject({
      payload: {
        summary: '保留关键上下文\n压缩 4 条 · 摘要覆盖 6 条 · 触发：上下文用量溢出',
      },
    });
  });

  it.each([
    ['provider_overflow', '触发：上游上下文溢出'],
    ['proactive_near_overflow', '触发：接近上限主动压缩'],
    ['manual', '触发：手动压缩'],
  ] as const)('cause=%s 追加对应触发说明', (cause, expectedLine) => {
    const content = createAssistantEventContent({
      type: 'compaction',
      summary: '摘要',
      trigger: 'automatic',
      cause,
    });

    const payload = parseCard(content)['payload'] as Record<string, unknown>;
    expect(payload['summary']).toContain(expectedLine);
  });

  it.each([
    ['automatic', '系统已压缩较早的对话内容，以腾出上下文空间。'],
    ['manual', '会话上下文已压缩。'],
  ] as const)('缺少摘要与元信息时按 trigger=%s 回退文案', (trigger, expectedSummary) => {
    const content = createAssistantEventContent({ type: 'compaction', summary: '', trigger });

    const payload = parseCard(content)['payload'] as Record<string, unknown>;
    expect(payload['summary']).toBe(expectedSummary);
  });

  it('phase=started 与 failed 原样透传', () => {
    const started = createAssistantEventContent({
      type: 'compaction',
      summary: 's',
      trigger: 'manual',
      phase: 'started',
    });
    const failed = createAssistantEventContent({
      type: 'compaction',
      summary: 's',
      trigger: 'manual',
      phase: 'failed',
    });

    expect(parseCard(started)).toMatchObject({ payload: { phase: 'started' } });
    expect(parseCard(failed)).toMatchObject({ payload: { phase: 'failed' } });
  });
});

describe('createAssistantEventContent · permission / question', () => {
  it('permission_asked 生成等待权限卡片', () => {
    const content = createAssistantEventContent({
      type: 'permission_asked',
      requestId: 'req-1',
      toolName: 'Bash',
      scope: 'session',
      reason: '需要执行构建命令',
      riskLevel: 'high',
      previewAction: 'npm run build',
    });

    expect(parseEventCardPayload(content)).toEqual({
      kind: 'permission',
      title: '等待权限 · Bash',
      message: 'npm run build\n需要执行构建命令\nsession · high',
      requestId: 'req-1',
      status: 'paused',
    });
  });

  it('permission_asked 过滤空的 previewAction', () => {
    const content = createAssistantEventContent({
      type: 'permission_asked',
      requestId: 'req-2',
      toolName: 'Bash',
      scope: 'global',
      reason: '',
      riskLevel: 'low',
      previewAction: '   ',
    });

    expect(parseEventCardPayload(content).message).toBe('global · low');
  });

  it.each([
    ['once', '本次允许', 'success'],
    ['session', '本会话允许', 'success'],
    ['permanent', '永久允许', 'success'],
    ['reject', '已拒绝', 'error'],
  ] as const)('permission_replied decision=%s → 文案与状态', (decision, message, status) => {
    const content = createAssistantEventContent({
      type: 'permission_replied',
      requestId: 'req-1',
      decision,
    });

    expect(parseEventCardPayload(content)).toMatchObject({
      kind: 'permission',
      title: '权限已响应',
      message,
      requestId: 'req-1',
      status,
    });
  });

  it('question_asked 生成等待回答卡片（不含 requestId）', () => {
    const content = createAssistantEventContent({
      type: 'question_asked',
      requestId: 'q-1',
      toolName: 'AskUserQuestion',
      title: '请选择目标环境',
    });

    const payload = parseEventCardPayload(content);
    expect(payload).toEqual({
      kind: 'question',
      title: '等待回答 · AskUserQuestion',
      message: '请选择目标环境',
      status: 'paused',
    });
    expect(payload.requestId).toBeUndefined();
  });

  it('问题类卡片生成 kind=question，而 parseAssistantEventContent 不识别该 kind', () => {
    const content = requireContent(
      createAssistantEventContent({
        type: 'question_asked',
        requestId: 'q-1',
        toolName: 'AskUserQuestion',
        title: '请选择目标环境',
      }),
    );

    expect(parseEventCardPayload(content).kind).toBe('question');
    expect(parseAssistantEventContent(content)).toBeNull();
  });

  it.each([
    ['answered', '已回答，继续执行。', 'success'],
    ['dismissed', '已忽略，等待进一步处理。', 'paused'],
  ] as const)('question_replied status=%s → 文案与状态', (status, message, expectedStatus) => {
    const content = createAssistantEventContent({
      type: 'question_replied',
      requestId: 'q-1',
      status,
    });

    expect(parseEventCardPayload(content)).toMatchObject({
      kind: 'question',
      message,
      status: expectedStatus,
    });
  });

  it('kindOverride 覆盖权限卡片的自动分类', () => {
    const content = createAssistantEventContent(
      {
        type: 'permission_asked',
        requestId: 'req-1',
        toolName: 'Bash',
        scope: 'session',
        reason: '原因',
        riskLevel: 'low',
      },
      { kindOverride: 'question' },
    );

    expect(parseEventCardPayload(content).kind).toBe('question');
  });
});

describe('createAssistantEventContent · task / session / audit', () => {
  it.each([
    ['in_progress', '进行中', 'running'],
    ['done', '已完成', 'success'],
    ['failed', '失败', 'error'],
    ['cancelled', '已取消', 'paused'],
    ['pending', '待开始', 'paused'],
  ] as const)('task_update status=%s → 标题与状态', (status, label, expectedStatus) => {
    const content = createAssistantEventContent({
      type: 'task_update',
      taskId: 'task-1',
      label: '重构模块',
      status,
    });

    expect(parseEventCardPayload(content)).toMatchObject({
      title: `任务${label} · 重构模块`,
      status: expectedStatus,
    });
  });

  it('task_update 拼装代理/结果/父任务/会话信息并识别 agent 分类', () => {
    const content = createAssistantEventContent({
      type: 'task_update',
      taskId: 'task-1',
      label: '并发审查',
      status: 'done',
      assignedAgent: 'oracle',
      result: '通过',
      parentTaskId: 'parent-1',
      sessionId: 'session-9',
    });

    expect(parseEventCardPayload(content)).toMatchObject({
      kind: 'agent',
      message: '代理：oracle\n结果：通过\n父任务：parent-1\n会话：session-9',
      status: 'success',
    });
  });

  it('task_update 优先展示错误信息而不是结果', () => {
    const content = createAssistantEventContent({
      type: 'task_update',
      taskId: 'task-1',
      label: '失败任务',
      status: 'failed',
      result: '不应出现的结果',
      errorMessage: '上游超时',
    });

    const payload = parseEventCardPayload(content);
    expect(payload.message).toBe('错误：上游超时');
    expect(payload.message).not.toContain('不应出现的结果');
  });

  it('task_update 按标签分类 mcp / task', () => {
    expect(
      parseEventCardPayload(
        createAssistantEventContent({
          type: 'task_update',
          taskId: 'task-1',
          label: 'mcp 工具调用',
          status: 'in_progress',
        }),
      ).kind,
    ).toBe('mcp');
    expect(
      parseEventCardPayload(
        createAssistantEventContent({
          type: 'task_update',
          taskId: 'task-2',
          label: '任务进度',
          status: 'in_progress',
        }),
      ).kind,
    ).toBe('task');
  });

  it('session_child 生成子会话卡片', () => {
    const content = createAssistantEventContent({
      type: 'session_child',
      sessionId: 'session-2',
      parentSessionId: 'session-1',
      title: '子任务',
    });

    expect(parseEventCardPayload(content)).toMatchObject({
      kind: 'task',
      title: '已创建子会话',
      message: '子任务\nsession-2',
      status: 'success',
    });
  });

  it('session_child 缺少 title 时退回会话 ID 作为分类文本', () => {
    const content = createAssistantEventContent({
      type: 'session_child',
      sessionId: 'session-2',
      parentSessionId: 'session-1',
    });

    expect(parseEventCardPayload(content)).toMatchObject({
      kind: 'tool',
      message: 'session-2',
    });
  });

  it('audit_ref 生成审计引用卡片并按工具名分类', () => {
    const withTool = createAssistantEventContent({
      type: 'audit_ref',
      auditLogId: 'audit-9',
      toolName: 'write',
    });

    expect(parseEventCardPayload(withTool)).toMatchObject({
      kind: 'tool',
      title: '已记录审计引用',
      message: '工具：write\n审计 ID：audit-9',
      status: 'success',
    });

    const withoutTool = createAssistantEventContent({ type: 'audit_ref', auditLogId: 'audit-9' });
    expect(parseEventCardPayload(withoutTool)).toMatchObject({
      kind: 'audit',
      message: '审计 ID：audit-9',
    });
  });

  it('未处理的事件类型返回 null', () => {
    const usageEvent: Extract<RunEvent, { type: 'usage' }> = {
      type: 'usage',
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      round: 1,
    };

    expect(createAssistantEventContent(usageEvent)).toBeNull();
    expect(createAssistantEventContent({ type: 'done', stopReason: 'end_turn' })).toBeNull();
  });
});

describe('createCommandCardContent', () => {
  it('compaction 命令卡片规范化为 completed 阶段', () => {
    const content = createCommandCardContent({
      type: 'compaction',
      title: 'compact',
      summary: '命令触发的压缩',
      trigger: 'manual',
    });

    expect(parseCard(content)).toEqual({
      type: 'compaction',
      payload: {
        title: 'compact',
        summary: '命令触发的压缩',
        trigger: 'manual',
        phase: 'completed',
      },
    });
  });

  it.each([
    ['info', 'running'],
    ['success', 'success'],
    ['warning', 'paused'],
    ['error', 'error'],
  ] as const)('status 卡片 tone=%s 映射为 %s', (tone, expectedStatus) => {
    const content = createCommandCardContent({
      type: 'status',
      title: '普通工具执行',
      message: '完成',
      tone,
    });

    expect(parseEventCardPayload(content)).toMatchObject({
      kind: 'tool',
      status: expectedStatus,
    });
  });

  it.each([
    ['context7 查询', 'mcp'],
    ['技能安装完成', 'skill'],
    ['subagent 启动', 'agent'],
    ['审计记录', 'audit'],
    ['compact finished', 'compaction'],
    ['任务进度', 'task'],
    ['普通工具', 'tool'],
  ] as const)('status 卡片按标题自动分类 %s → %s', (title, expectedKind) => {
    const content = createCommandCardContent({ type: 'status', title, message: '', tone: 'info' });

    expect(parseEventCardPayload(content).kind).toBe(expectedKind);
  });

  it('kindOverride 覆盖 status 卡片的自动分类', () => {
    const content = createCommandCardContent(
      { type: 'status', title: 'context7 查询', message: '', tone: 'info' },
      { kindOverride: 'tool' },
    );

    expect(parseEventCardPayload(content).kind).toBe('tool');
  });
});
