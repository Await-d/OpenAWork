import { describe, expect, it } from 'vitest';

import { parseSessionReadOutput } from './session-read-view.js';

/** 形状对齐网关侧 `runSessionReadTool` 拼出的文本。 */
const TRANSCRIPT = [
  'Session: sess_123',
  'Messages: 42（仅显示最近 40 条；调大 limit 可取更早消息，上限 500）',
  'Date Range: 2025-01-01T09:00:00.000Z to 2025-01-02T18:00:00.000Z',
  '提示：默认折叠长消息；需要完整文本时传 full: true。',
  '',
  '[Message 3/42] user (2025-01-02T03:04:05.000Z)',
  '帮我查一下天气',
  '',
  '[Message 4/42] assistant (2025-01-02T03:04:10.000Z)',
  '[tool_call] get_weather {"city":"北京"}',
  '[tool_result] {"temp":3,"desc":"晴"}',
  '',
  '[Message 5/42] assistant (2025-01-02T03:04:12.000Z)',
  '北京今天晴，3℃',
].join('\n');

describe('parseSessionReadOutput', () => {
  it('解析头部元信息与消息条目', () => {
    const view = parseSessionReadOutput(TRANSCRIPT);

    expect(view?.sessionId).toBe('sess_123');
    expect(view?.messageCount).toBe(42);
    expect(view?.dateRange).toContain('2025-01-01');
    expect(view?.hint).toContain('full: true');
    expect(view?.entries).toHaveLength(3);
    expect(view?.entries[0]).toMatchObject({ index: 3, total: 42, role: 'user' });
    expect(view?.entries[0]?.timestamp).toBe('2025-01-02T03:04:05.000Z');
  });

  it('工具调用与结果拆成独立行类型', () => {
    const view = parseSessionReadOutput(TRANSCRIPT);
    const lines = view?.entries[1]?.lines ?? [];

    expect(lines[0]).toMatchObject({
      kind: 'tool_call',
      toolName: 'get_weather',
      text: '{"city":"北京"}',
    });
    expect(lines[1]).toMatchObject({ kind: 'tool_result', text: '{"temp":3,"desc":"晴"}' });
  });

  it('普通消息正文保留为 text 行', () => {
    const view = parseSessionReadOutput(TRANSCRIPT);

    expect(view?.entries[2]?.lines[0]).toMatchObject({ kind: 'text', text: '北京今天晴，3℃' });
  });

  it('附加段落（Todos / Debug …）不会被吞进最后一条消息', () => {
    const withExtras = `${TRANSCRIPT}\n\nTodos:\n[{"id":"t1"}]\n\nDebug Snapshots:\n- snap_1`;
    const view = parseSessionReadOutput(withExtras);
    const entries = view?.entries ?? [];
    const last = entries[entries.length - 1];

    expect(last?.lines).toHaveLength(1);
    expect(last?.lines.map((line) => line.text)).not.toContain('[{"id":"t1"}]');
  });

  it('`{ output }` 信封同样能解析', () => {
    const view = parseSessionReadOutput({ output: TRANSCRIPT });

    expect(view?.entries).toHaveLength(3);
  });

  it('没有消息条目时返回 null，交给通用兜底', () => {
    expect(parseSessionReadOutput('随便一段文本')).toBeNull();
    expect(parseSessionReadOutput('')).toBeNull();
    expect(parseSessionReadOutput(null)).toBeNull();
  });
});

describe('parseSessionReadOutput · 来源与通知限定词', () => {
  it('括号里的限定词与时间拆开，且限定词内部的 · 整体归它', () => {
    const text = [
      'Session: sess_1',
      '',
      '[Message 1/3] synthetic (2026-01-02T03:04:05.000Z · subagent · scout · failed)',
      '子代理已完成',
    ].join('\n');

    const entry = parseSessionReadOutput(text)?.entries[0];

    expect(entry?.timestamp).toBe('2026-01-02T03:04:05.000Z');
    expect(entry?.notice).toBe('subagent · scout · failed');
  });

  it('没有限定词时只有时间，notice 不出现', () => {
    const entry = parseSessionReadOutput('[Message 1/1] user (2026-01-02T03:04:05.000Z)\n你好')
      ?.entries[0];

    expect(entry?.timestamp).toBe('2026-01-02T03:04:05.000Z');
    expect(entry?.notice).toBeUndefined();
  });

  it('Source 行解析成会话级来源，不影响其它元信息', () => {
    const text = [
      'Session: sess_1',
      'Source: channel · wechat · wxid_abc123',
      'Messages: 2（仅显示最近 1 条）',
      '',
      '[Message 1/2] user (2026-01-02T03:04:05.000Z)',
      '你好',
    ].join('\n');

    const view = parseSessionReadOutput(text);

    expect(view?.source).toBe('channel · wechat · wxid_abc123');
    expect(view?.sessionId).toBe('sess_1');
    expect(view?.messageCount).toBe(2);
  });

  it('没有 Source 行时来源为空（普通会话不该凭空多出一行）', () => {
    const view = parseSessionReadOutput('[Message 1/1] user (2026-01-02T03:04:05.000Z)\n你好');

    expect(view?.source).toBeUndefined();
  });
});
