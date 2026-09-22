/**
 * T-17 / T-18 回归：GUI 子会话与逐步进度投影。
 *
 * 覆盖：
 *  1. 子会话 INSERT 的 metadata 含 `parentSessionId`（**T-20 取消链路回归守卫**：
 *     `cancelDescendantSessionStreams` 按该键 BFS 收集后代）、title / 状态等落库字段；
 *  2. 指令作为 user 消息、每步作为 assistant 消息写入子会话；
 *  3. 每步向父会话发 `tool_progress`，`subTools` 为累积快照且 `completedCount` 递增；
 *  4. `finalize` 落最终摘要并发出全完成快照，且幂等（只落一次终态）；
 *  5. 失败安全：写库 / 发事件抛错都不得向外抛，GUI 任务不受影响。
 *
 * 三个副作用模块全部用模块级 mock 替换（同 `session-entry-store.test.ts` 的范式），
 * 因此不依赖 SQLite 连接。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchSubToolProgress } from '@openAwork/shared';

const h = vi.hoisted(() => {
  const sessionInserts: Array<{ sql: string; params: unknown[] }> = [];
  const childMessages: Array<{
    sessionId: string;
    userId: string;
    role: string;
    text: string;
  }> = [];
  const publishedEvents: Array<{ sessionId: string; event: Record<string, unknown> }> = [];
  const failures = {
    sessionInsert: false,
    messageWrite: false,
    eventPublish: false,
  };
  const reset = (): void => {
    sessionInserts.length = 0;
    childMessages.length = 0;
    publishedEvents.length = 0;
    failures.sessionInsert = false;
    failures.messageWrite = false;
    failures.eventPublish = false;
  };
  return { sessionInserts, childMessages, publishedEvents, failures, reset };
});

vi.mock('../../infra/db.js', () => ({
  sqliteRun: (sql: string, params: unknown[] = []): void => {
    if (h.failures.sessionInsert) {
      throw new Error('sqlite unavailable');
    }
    h.sessionInserts.push({ sql, params });
  },
}));

vi.mock('../../message/message-v2-adapter.js', () => ({
  appendSessionMessageV2: (input: {
    sessionId: string;
    userId: string;
    role: string;
    content: Array<{ type: string; text?: string }>;
  }): { id: string } => {
    if (h.failures.messageWrite) {
      throw new Error('message store unavailable');
    }
    h.childMessages.push({
      sessionId: input.sessionId,
      userId: input.userId,
      role: input.role,
      text: input.content.map((part) => part.text ?? '').join(''),
    });
    return { id: `message-${h.childMessages.length}` };
  },
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: (
    sessionId: string,
    event: Record<string, unknown>,
  ): { seq: null; rowId: null } => {
    if (h.failures.eventPublish) {
      throw new Error('run event store unavailable');
    }
    h.publishedEvents.push({ sessionId, event });
    return { seq: null, rowId: null };
  },
}));

import {
  GUI_PROGRESS_TOOL_NAME,
  GUI_SESSION_TITLE,
  createGuiSession,
} from '../../tools/gui/gui-session.js';
import type { CreateGuiSessionInput, GuiSessionStep } from '../../tools/gui/gui-session.js';

const PARENT_SESSION_ID = 'parent-session-1';

function baseInput(overrides?: Partial<CreateGuiSessionInput>): CreateGuiSessionInput {
  return {
    userId: 'user-1',
    parentSessionId: PARENT_SESSION_ID,
    toolCallId: 'call-1',
    instruction: '打开系统设置',
    maxSteps: 12,
    providerId: 'gui-endpoint',
    modelId: 'ui-tars-7b',
    variant: 'v1.5',
    ...overrides,
  };
}

function baseStep(overrides?: Partial<GuiSessionStep>): GuiSessionStep {
  return {
    index: 1,
    thought: '先点击开始菜单',
    action: 'click',
    success: true,
    ...overrides,
  };
}

interface InsertedSession {
  id: string;
  userId: string;
  messagesJson: string;
  stateStatus: string;
  metadata: Record<string, unknown>;
  title: string;
}

/** 读取第 n 次 `INSERT INTO sessions` 的落库内容（缺字段时直接失败，便于定位）。 */
function readSessionInsert(index = 0): InsertedSession {
  const insert = h.sessionInserts[index];
  if (!insert) {
    throw new Error(`expected session insert #${index}, got ${h.sessionInserts.length}`);
  }
  const [id, userId, messagesJson, stateStatus, metadataJson, title] = insert.params;
  return {
    id: String(id),
    userId: String(userId),
    messagesJson: String(messagesJson),
    stateStatus: String(stateStatus),
    metadata: JSON.parse(String(metadataJson)) as Record<string, unknown>,
    title: String(title),
  };
}

interface ToolProgressRecord {
  type: string;
  toolCallId: string;
  toolName: string;
  subTools: BatchSubToolProgress[];
  completedCount: number;
  totalCount: number;
}

/** 父会话收到的 `tool_progress` 快照，按发生顺序。 */
function progressEvents(sessionId = PARENT_SESSION_ID): ToolProgressRecord[] {
  return h.publishedEvents
    .filter((entry) => entry.sessionId === sessionId && entry.event.type === 'tool_progress')
    .map((entry) => entry.event as unknown as ToolProgressRecord);
}

beforeEach(() => {
  h.reset();
  // 失败安全用例会产生预期内的降级告警，静音以免污染测试输出。
  vi.spyOn(console, 'warn').mockImplementation(() => {
    /* 预期内的降级告警 */
  });
});

describe('createGuiSession — 子会话落库（T-17 / T-20）', () => {
  it('metadata 含 parentSessionId，并带上溯源字段（取消链路回归守卫）', () => {
    const handle = createGuiSession(baseInput());

    expect(h.sessionInserts).toHaveLength(1);
    const insert = readSessionInsert();
    expect(insert.id).toBe(handle.sessionId);
    expect(insert.title).toBe(GUI_SESSION_TITLE);
    expect(insert.title).toBe('computer_use');
    expect(insert.userId).toBe('user-1');
    expect(insert.stateStatus).toBe('idle');
    expect(insert.messagesJson).toBe('[]');
    // T-20 的关键：父会话取消时按该键 BFS 找到这层血缘。
    expect(insert.metadata['parentSessionId']).toBe(PARENT_SESSION_ID);
    expect(insert.metadata['createdByTool']).toBe('computer_use');
    expect(insert.metadata['subagentType']).toBe('gui-agent');
    expect(insert.metadata['providerId']).toBe('gui-endpoint');
    expect(insert.metadata['modelId']).toBe('ui-tars-7b');
    expect(insert.metadata['variant']).toBe('v1.5');
    expect(insert.metadata['maxSteps']).toBe(12);
    expect(insert.metadata['toolCallId']).toBe('call-1');
    // 子会话 id 必须与句柄一致，否则消息/进度会写到别的会话上。
    expect(handle.sessionId).not.toBe(PARENT_SESSION_ID);
  });

  it('省略可选项时不写入 undefined 键', () => {
    createGuiSession(baseInput({ providerId: undefined, modelId: undefined, variant: undefined }));
    const metadata = readSessionInsert().metadata;
    expect('providerId' in metadata).toBe(false);
    expect('modelId' in metadata).toBe(false);
    expect('variant' in metadata).toBe(false);
  });

  it('指令写入子会话的 user 消息，步骤写入 assistant 消息', () => {
    const handle = createGuiSession(baseInput());
    handle.recordStep(baseStep({ index: 1, thought: '点击开始', action: 'click' }));
    handle.recordStep(
      baseStep({
        index: 2,
        thought: '输入关键词',
        action: 'type',
        success: false,
        detail: '无法解析输入文本',
      }),
    );
    handle.finalize('已达到最大循环步数 12，任务未完成', false);

    expect(h.childMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'assistant',
    ]);
    expect(h.childMessages[0]?.text).toBe('打开系统设置');
    expect(h.childMessages[0]?.sessionId).toBe(handle.sessionId);
    expect(h.childMessages[0]?.userId).toBe('user-1');
    expect(h.childMessages[1]?.text).toBe('Thought: 点击开始\nAction: click\nResult: 成功');
    expect(h.childMessages[2]?.text).toBe(
      'Thought: 输入关键词\nAction: type\nResult: 失败：无法解析输入文本',
    );
    expect(h.childMessages[3]?.text).toContain('已达到最大循环步数 12');
  });
});

describe('createGuiSession — 父会话进度投影（T-18）', () => {
  it('每步发 tool_progress：subTools 累积、completedCount 递增、totalCount 为步数预算', () => {
    const handle = createGuiSession(baseInput({ maxSteps: 5 }));
    handle.recordStep(baseStep({ index: 1, thought: '第一步', action: 'click' }));
    handle.recordStep(baseStep({ index: 2, thought: '第二步', action: 'type' }));
    handle.recordStep(
      baseStep({ index: 3, thought: '第三步未解析出动作', action: '', success: false }),
    );

    const events = progressEvents();
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.toolCallId).toBe('call-1');
      expect(event.toolName).toBe(GUI_PROGRESS_TOOL_NAME);
      expect(event.totalCount).toBe(5);
    }

    expect(events[0]?.subTools).toHaveLength(1);
    expect(events[0]?.completedCount).toBe(1);
    expect(events[1]?.subTools).toHaveLength(2);
    expect(events[1]?.completedCount).toBe(2);
    expect(events[2]?.subTools).toHaveLength(3);
    expect(events[2]?.completedCount).toBe(3);

    // 累积快照：早先事件不会被后续步骤就地改写（订阅方可能仍持有旧引用）。
    expect(events[0]?.subTools).toHaveLength(1);

    expect(events[2]?.subTools.map((sub) => sub.tool)).toEqual(['click', 'type', 'thought']);
    expect(events[2]?.subTools.map((sub) => sub.status)).toEqual([
      'completed',
      'completed',
      'error',
    ]);
    expect(events[2]?.subTools[2]?.isError).toBe(true);
    expect(events[2]?.subTools[0]?.isError).toBeUndefined();
    expect(events[2]?.subTools[0]?.index).toBe(1);
    expect(String(events[2]?.subTools[0]?.output)).toContain('Thought: 第一步');
  });

  it('单步文本在进度事件里截断，子会话消息保留全文', () => {
    const handle = createGuiSession(baseInput());
    const longThought = '想'.repeat(700);
    handle.recordStep(baseStep({ thought: longThought }));

    const output = String(progressEvents()[0]?.subTools[0]?.output);
    expect(output.length).toBeLessThan(600);
    expect(output).toContain('已截断');
    expect(h.childMessages[1]?.text).toContain(longThought);
  });

  it('finalize 写最终摘要并发出全完成快照，且幂等', () => {
    const handle = createGuiSession(baseInput());
    handle.recordStep(baseStep({ index: 1, action: 'click' }));
    handle.recordStep(baseStep({ index: 2, action: 'finished' }));

    handle.finalize('任务完成', true);
    handle.finalize('任务完成', true);

    const events = progressEvents();
    expect(events).toHaveLength(3);
    const finalSnapshot = events[2];
    expect(finalSnapshot?.subTools).toHaveLength(2);
    expect(finalSnapshot?.subTools.every((sub) => sub.status === 'completed')).toBe(true);
    expect(finalSnapshot?.completedCount).toBe(2);
    expect(finalSnapshot?.totalCount).toBe(12);
    // 幂等：第二次 finalize 不再追加事件、也不再写消息。
    // 子会话消息 = 指令 1 条 + 步骤 2 条 + 最终摘要 1 条。
    expect(h.childMessages).toHaveLength(4);
    expect(h.childMessages[3]?.text).toContain('任务完成');
  });

  it('toolCallId 为空时不发进度（避免父会话出现幽灵工具卡片）', () => {
    const handle = createGuiSession(baseInput({ toolCallId: '' }));
    handle.recordStep(baseStep());
    handle.finalize('任务完成', true);

    expect(progressEvents()).toHaveLength(0);
    // 子会话自身照常落库。
    expect(h.sessionInserts).toHaveLength(1);
    expect(h.childMessages).toHaveLength(3);
  });
});

describe('createGuiSession — 失败安全（不得让 GUI 任务失败）', () => {
  it('子会话 INSERT 抛错时不外抛：跳过子会话写库，进度照发', () => {
    h.failures.sessionInsert = true;
    const handle = createGuiSession(baseInput());

    expect(() => {
      handle.recordStep(baseStep());
      handle.finalize('任务完成', true);
    }).not.toThrow();

    expect(handle.sessionId.length).toBeGreaterThan(0);
    expect(h.sessionInserts).toHaveLength(0);
    expect(h.childMessages).toHaveLength(0);
    // 降级后仍要向父会话上报进度，否则用户完全看不到 GUI 任务在跑。
    expect(progressEvents()).toHaveLength(2);
  });

  it('写子会话消息抛错时不外抛，且后续步骤不再重复写库', () => {
    h.failures.messageWrite = true;
    const handle = createGuiSession(baseInput());

    expect(() => {
      handle.recordStep(baseStep({ index: 1 }));
      handle.recordStep(baseStep({ index: 2 }));
      handle.finalize('任务完成', true);
    }).not.toThrow();

    expect(h.childMessages).toHaveLength(0);
    // 首次失败后关闭子会话写库，但每步进度仍然上报。
    expect(progressEvents()).toHaveLength(3);
  });

  it('发布进度抛错时不外抛，子会话消息照写', () => {
    h.failures.eventPublish = true;
    const handle = createGuiSession(baseInput());

    expect(() => {
      handle.recordStep(baseStep());
      handle.finalize('任务完成', true);
    }).not.toThrow();

    expect(h.sessionInserts).toHaveLength(1);
    expect(h.childMessages).toHaveLength(3);
  });
});
