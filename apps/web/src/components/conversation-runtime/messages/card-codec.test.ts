/**
 * card-codec 负责内联卡片的 JSON 编解码：
 * assistant_event / status / compaction / compaction_marker。
 * 所有 parse* 对非本类型 JSON 与畸形 JSON 必须返回 null，绝不能抛错；
 * create* → parse* 必须保持语义往返。
 */
import { describe, expect, it } from 'vitest';
import type { AssistantEventKind } from './message-model.js';
import {
  createAssistantEventCardContent,
  createCompactionCardContent,
  createStatusCardContent,
  parseAssistantEventContent,
  parseCompactionCardContent,
} from './card-codec.js';

const EVENT_KINDS: AssistantEventKind[] = [
  'agent',
  'audit',
  'compaction',
  'mcp',
  'permission',
  'skill',
  'task',
  'tool',
];

describe('assistant_event 卡片', () => {
  it('create → parse 完整往返（含 requestId）', () => {
    const payload = {
      kind: 'permission' as const,
      message: '等待审批',
      requestId: 'req-1',
      status: 'paused' as const,
      title: '权限请求',
    };
    const content = createAssistantEventCardContent(payload);

    expect(JSON.parse(content)).toEqual({
      source: 'openawork_internal',
      type: 'assistant_event',
      payload,
    });
    expect(parseAssistantEventContent(content)).toEqual(payload);
  });

  it('无 requestId 时往返保留 undefined', () => {
    const content = createAssistantEventCardContent({
      kind: 'tool',
      message: 'm',
      status: 'success',
      title: 't',
    });

    const parsed = parseAssistantEventContent(content);
    expect(parsed).toMatchObject({ kind: 'tool', status: 'success', title: 't', message: 'm' });
    expect(parsed?.requestId).toBeUndefined();
  });

  it.each(EVENT_KINDS)('kind=%s 可被解析回环', (kind) => {
    const content = createAssistantEventCardContent({
      kind,
      message: 'm',
      status: 'running',
      title: 't',
    });

    expect(parseAssistantEventContent(content)?.kind).toBe(kind);
  });

  it('畸形 JSON / 非 assistant_event JSON 返回 null', () => {
    expect(parseAssistantEventContent('not json')).toBeNull();
    expect(parseAssistantEventContent('null')).toBeNull();
    expect(parseAssistantEventContent('"str"')).toBeNull();
    expect(parseAssistantEventContent(JSON.stringify({ type: 'status', payload: {} }))).toBeNull();
  });

  it('非法 kind / status / 缺失 title / message 返回 null', () => {
    const event = (payload: unknown): string =>
      JSON.stringify({ type: 'assistant_event', payload });

    expect(
      parseAssistantEventContent(
        event({ kind: 'bogus', status: 'success', title: 't', message: 'm' }),
      ),
    ).toBeNull();
    expect(
      parseAssistantEventContent(
        event({ kind: 'tool', status: 'bogus', title: 't', message: 'm' }),
      ),
    ).toBeNull();
    expect(parseAssistantEventContent(event({ kind: 'tool', status: 'success' }))).toBeNull();
    expect(
      parseAssistantEventContent(event({ kind: 'tool', status: 'success', title: 1 })),
    ).toBeNull();
    expect(
      parseAssistantEventContent(JSON.stringify({ type: 'assistant_event', payload: 'x' })),
    ).toBeNull();
  });
});

describe('status 卡片', () => {
  it('createStatusCardContent 生成 { type: status, payload }', () => {
    expect(
      JSON.parse(createStatusCardContent({ title: '标题', message: '内容', tone: 'warning' })),
    ).toEqual({ type: 'status', payload: { title: '标题', message: '内容', tone: 'warning' } });
  });

  it('四种 tone 都可序列化', () => {
    for (const tone of ['info', 'success', 'warning', 'error'] as const) {
      const parsed = JSON.parse(createStatusCardContent({ title: 't', message: 'm', tone })) as {
        payload: { tone: string };
      };

      expect(parsed.payload.tone).toBe(tone);
    }
  });
});

describe('compaction 卡片', () => {
  it('create → parse 往返（含 phase）', () => {
    const content = createCompactionCardContent({
      phase: 'started',
      summary: '正在压缩',
      title: 'compact',
      trigger: 'manual',
    });

    const parsed = parseCompactionCardContent(content);
    expect(parsed).not.toBeNull();
    expect(JSON.parse(parsed as string)).toEqual({
      type: 'compaction',
      payload: { title: 'compact', summary: '正在压缩', trigger: 'manual', phase: 'started' },
    });
  });

  it('非法 phase 在 parse 时被丢弃', () => {
    const parsed = parseCompactionCardContent(
      JSON.stringify({
        type: 'compaction',
        payload: { title: 't', summary: 's', trigger: 'automatic', phase: 'weird' },
      }),
    );

    expect(JSON.parse(parsed as string)).toEqual({
      type: 'compaction',
      payload: { title: 't', summary: 's', trigger: 'automatic' },
    });
  });

  it('compaction_marker 转成 compaction 卡片：缺 title 回退 compact、trigger 非 automatic 视为 manual', () => {
    const parsed = parseCompactionCardContent(
      JSON.stringify({ type: 'compaction_marker', payload: { summary: '已压缩' } }),
    );

    expect(JSON.parse(parsed as string)).toEqual({
      type: 'compaction',
      payload: { title: 'compact', summary: '已压缩', trigger: 'manual' },
    });
  });

  it('compaction_marker 的空白 title 也回退 compact', () => {
    const parsed = parseCompactionCardContent(
      JSON.stringify({
        type: 'compaction_marker',
        payload: { title: '   ', summary: 's', trigger: 'automatic' },
      }),
    );

    expect(JSON.parse(parsed as string)).toEqual({
      type: 'compaction',
      payload: { title: 'compact', summary: 's', trigger: 'automatic' },
    });
  });

  it('畸形 / 非本类型输入返回 null', () => {
    expect(parseCompactionCardContent('not json')).toBeNull();
    expect(parseCompactionCardContent(JSON.stringify({ type: 'status', payload: {} }))).toBeNull();
    expect(
      parseCompactionCardContent(
        JSON.stringify({ type: 'compaction', payload: { title: 't', summary: 's' } }),
      ),
    ).toBeNull();
    expect(
      parseCompactionCardContent(
        JSON.stringify({ type: 'compaction_marker', payload: { title: 't' } }),
      ),
    ).toBeNull();
  });
});
