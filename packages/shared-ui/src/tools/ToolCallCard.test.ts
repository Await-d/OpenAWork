import { describe, expect, it } from 'vitest';
import { resolveToolCallCardDisplayData } from './ToolCallCard.js';

/**
 * `patch` (and write/edit/multi_edit) outputs are object envelopes
 * that get JSON-stringified during agent-gateway storage. The UI receives
 * the encoded string, so the diff resolver has to recover the structured
 * shape before it can produce a real diff view — otherwise the user sees
 * a 4KB raw JSON dump in the generic ExpandableOutput fallback.
 */
describe('resolveToolCallCardDisplayData diffView (JSON-encoded envelope recovery)', () => {
  it('recovers a single-file patch envelope from a JSON string', () => {
    const output = JSON.stringify({
      success: true,
      files: [
        {
          action: 'update',
          path: '/repo/src/foo.ts',
          before: 'const a = 1;\n',
          after: 'const a = 2;\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
        },
      ],
    });

    const data = resolveToolCallCardDisplayData({
      toolName: 'patch',
      input: { patchText: '...' },
      output,
    });

    expect(data.diffView).toBeDefined();
    expect(data.diffView?.filePath).toBe('/repo/src/foo.ts');
    // `readNonEmptyString` trims surrounding whitespace, so the trailing
    // `\n` is not preserved — that's fine for the diff renderer which
    // re-splits on `\n` regardless.
    expect(data.diffView?.beforeText).toBe('const a = 1;');
    expect(data.diffView?.afterText).toBe('const a = 2;');
    // Single-file branch produces beforeText/afterText, not files[].
    expect(data.diffView?.files).toBeUndefined();
  });

  it('recovers a multi-file patch envelope from a JSON string', () => {
    const output = JSON.stringify({
      success: true,
      files: [
        {
          action: 'update',
          path: '/repo/a.ts',
          before: 'old a\n',
          after: 'new a\n',
          additions: 1,
          deletions: 1,
        },
        {
          action: 'add',
          path: '/repo/b.ts',
          before: '',
          after: 'new file\n',
          additions: 1,
          deletions: 0,
        },
      ],
    });

    const data = resolveToolCallCardDisplayData({
      toolName: 'patch',
      input: { patchText: '...' },
      output,
    });

    expect(data.diffView?.files).toHaveLength(2);
    expect(data.diffView?.summary).toContain('2 个文件');
  });

  it('does not parse JSON for bash-style string outputs', () => {
    // Strings that don't begin/end with `{` or `[` should never enter
    // JSON.parse — protects bash/grep stdout from being mis-detected.
    const data = resolveToolCallCardDisplayData({
      toolName: 'bash',
      input: { command: 'echo hi' },
      output: 'hi\n',
    });
    expect(data.diffView).toBeUndefined();
  });

  it('falls through gracefully on malformed JSON', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'patch',
      input: { patchText: '...' },
      output: '{ this is not valid json',
    });
    expect(data.diffView).toBeUndefined();
  });

  it('still recognises raw unified-diff string output', () => {
    const diff = `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n`;
    const data = resolveToolCallCardDisplayData({
      toolName: 'patch',
      input: { patchText: '...' },
      output: diff,
    });
    expect(data.diffView).toBeDefined();
    expect(data.diffView?.diffText).toBe(diff.trim());
  });
});

describe('resolveToolCallCardDisplayData 不再把对象序列化成摘要', () => {
  it('对象型首个输入参数给出键名概述而不是 JSON', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'custom_tool',
      input: { payload: { a: 1, b: 2 } },
    });
    expect(data.summary).toBe('payload：a、b');
  });

  it('无法提取字段的对象输出给出键名摘要而不是 JSON', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'custom_tool',
      input: {},
      output: { nested: { a: 1 } },
    });
    expect(data.outputPreview).toBe('字段：nested');
  });
});

/**
 * 子代理工具名与子会话 id 的解析口径：消息流卡片能否点击打开右侧预览，
 * 完全取决于 `taskMeta` 是否生成、`outputSessionId` / `requestedSessionId`
 * 是否能解析出子会话 id。
 */
describe('子代理工具（subagent / call_omo_agent / delegate_task）', () => {
  it('规范名 subagent 也生成 taskMeta 并携带子代理类型', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'subagent',
      input: { prompt: '调查 foo', subagent_type: 'explore' },
      output: { taskId: 't1', sessionId: 'ses_child_1', status: 'completed' },
    });

    expect(data.taskMeta).toBeDefined();
    expect(data.taskMeta?.agentType).toBe('explore');
    expect(data.taskMeta?.outputSessionId).toBe('ses_child_1');
    expect(data.taskSummary).toBeDefined();
  });

  it('上游别名 agent 作为子代理类型兜底', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'subagent',
      input: { prompt: '调查 foo', agent: 'oracle' },
    });

    expect(data.taskMeta?.agentType).toBe('oracle');
  });

  it('call_omo_agent 的文本输出从 <subagent sessionID="…"> 提取子会话 id', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'call_omo_agent',
      input: { prompt: '跑一下', subagent_type: 'explore' },
      output:
        'task_id: ses_child_2（如需继续本任务可用来 resume）\n<subagent sessionID="ses_child_2" state="completed">done</subagent>',
    });

    expect(data.taskMeta?.outputSessionId).toBe('ses_child_2');
  });

  it('call_omo_agent 的后台文本输出从「会话 ID：」行提取子会话 id', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'call_omo_agent',
      input: { prompt: '后台跑', subagent_type: 'explore', run_in_background: true },
      output: '后台 agent 任务已成功启动。\n\n任务 ID：t9\n会话 ID：ses_child_3\n描述：后台跑',
    });

    expect(data.taskMeta?.outputSessionId).toBe('ses_child_3');
  });

  it('resume 调用从输入侧 session_id 得到 requestedSessionId', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'subagent',
      input: { prompt: '继续', session_id: 'ses_child_4' },
    });

    expect(data.taskMeta?.requestedSessionId).toBe('ses_child_4');
  });

  it('delegate_task 同样进入子代理卡片口径', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'delegate_task',
      input: { description: '委派实施', prompt: '实现 X' },
      output: { taskId: 't2', sessionId: 'ses_child_5', status: 'running' },
    });

    expect(data.taskMeta).toBeDefined();
    expect(data.taskMeta?.outputSessionId).toBe('ses_child_5');
  });

  it('子代理标准输入字段不算「额外输入」', () => {
    const data = resolveToolCallCardDisplayData({
      toolName: 'subagent',
      input: {
        prompt: '实现 X',
        subagent_type: 'hephaestus',
        run_in_background: true,
        load_skills: ['a'],
      },
    });

    expect(data.taskMeta?.hasAdditionalInputFields).toBe(false);
  });
});
