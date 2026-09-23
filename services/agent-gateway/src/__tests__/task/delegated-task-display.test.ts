import { describe, expect, it } from 'vitest';
import { buildTaskToolTerminalMessage } from '../../task/delegated-task-display.js';

describe('buildTaskToolTerminalMessage', () => {
  it('包含 task_id 与 <subagent> 包裹（对齐参考库前台形态），正文取结果文本', () => {
    const message = buildTaskToolTerminalMessage({
      agent: 'explore',
      resultText: '子代理最终结论。',
      sessionId: 'sess-child',
      status: 'done',
    });

    expect(message).toContain('task_id: sess-child');
    expect(message).toContain(
      '<subagent sessionID="sess-child" state="completed">\n子代理最终结论。\n</subagent>',
    );
  });

  it('结果超长时截断并保留去子会话读全文的指引', () => {
    const message = buildTaskToolTerminalMessage({
      agent: 'explore',
      resultText: 'x'.repeat(25_000),
      sessionId: 'sess-child',
      status: 'done',
    });

    expect(message).toContain('[子代理结果过长，已截断');
    expect(message).toContain('sessionID: sess-child');
    // 20_000 上限 + task_id 头部 / 标签 / 提示开销。
    expect(message.length).toBeLessThan(21_000);
  });

  it('失败回退为「任务失败。」（state=error），取消回退为「任务已取消。」', () => {
    expect(
      buildTaskToolTerminalMessage({ agent: 'explore', sessionId: 'sess-child', status: 'failed' }),
    ).toContain('<subagent sessionID="sess-child" state="error">\n任务失败。\n</subagent>');
    expect(
      buildTaskToolTerminalMessage({
        agent: 'explore',
        sessionId: 'sess-child',
        status: 'cancelled',
      }),
    ).toContain('<subagent sessionID="sess-child" state="cancelled">\n任务已取消。\n</subagent>');
  });

  it('错误信息优先于结果文本', () => {
    const message = buildTaskToolTerminalMessage({
      agent: 'explore',
      errorMessage: '子代理执行失败。',
      resultText: '不应出现的结果',
      sessionId: 'sess-child',
      status: 'failed',
    });

    expect(message).toContain('子代理执行失败。');
    expect(message).not.toContain('不应出现的结果');
  });
});
