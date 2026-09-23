import { describe, expect, it } from 'vitest';
import {
  extractSubagentSessionIdFromText,
  isSubagentToolName,
  resolveSubagentSessionIdFromToolOutput,
  SUBAGENT_TOOL_NAMES,
} from './subagent-tool-names.js';

describe('isSubagentToolName', () => {
  it('识别规范名 / 历史别名 / 上游兼容名', () => {
    for (const name of SUBAGENT_TOOL_NAMES) {
      expect(isSubagentToolName(name)).toBe(true);
    }
  });

  it('大小写与空白不敏感', () => {
    expect(isSubagentToolName('  SUBAGENT ')).toBe(true);
    expect(isSubagentToolName('Call_Omo_Agent')).toBe(true);
  });

  it('普通工具名不误判（含任务图 CRUD 的 task_create）', () => {
    for (const name of ['read', 'bash', 'generate_image', 'task_create', 'background_output']) {
      expect(isSubagentToolName(name)).toBe(false);
    }
  });
});

describe('extractSubagentSessionIdFromText', () => {
  it('提取同步输出的 <subagent sessionID="…"> 标签', () => {
    const text =
      'task_id: ses_child_1（如需继续本任务可用来 resume）\n<subagent sessionID="ses_child_1" state="completed">done</subagent>';
    expect(extractSubagentSessionIdFromText(text)).toBe('ses_child_1');
  });

  it('提取后台输出的「会话 ID：」行', () => {
    const text = '后台 agent 任务已成功启动。\n\n任务 ID：t9\n会话 ID：ses_child_2\n描述：后台跑';
    expect(extractSubagentSessionIdFromText(text)).toBe('ses_child_2');
  });

  it('提取兼容 JSON 文本的 sessionID 字段', () => {
    expect(extractSubagentSessionIdFromText('{"sessionID":"ses_child_3"}')).toBe('ses_child_3');
    expect(extractSubagentSessionIdFromText('{"sessionId":"ses_child_4"}')).toBe('ses_child_4');
  });

  it('无子会话信息时返回 undefined', () => {
    expect(extractSubagentSessionIdFromText('执行成功，共修改 3 个文件。')).toBeUndefined();
  });
});

describe('resolveSubagentSessionIdFromToolOutput', () => {
  it('对象输出优先读取 sessionId / session_id / sessionID', () => {
    expect(resolveSubagentSessionIdFromToolOutput({ sessionId: 'ses_a' })).toBe('ses_a');
    expect(resolveSubagentSessionIdFromToolOutput({ session_id: 'ses_b' })).toBe('ses_b');
    expect(resolveSubagentSessionIdFromToolOutput({ sessionID: 'ses_c' })).toBe('ses_c');
  });

  it('字符串输出走文本提取', () => {
    expect(resolveSubagentSessionIdFromToolOutput('<subagent sessionID="ses_d"></subagent>')).toBe(
      'ses_d',
    );
  });

  it('JSON 字符串输出（历史消息序列化形态）按对象字段恢复', () => {
    expect(
      resolveSubagentSessionIdFromToolOutput(
        '{"taskId":"t1","sessionId":"ses_e","status":"completed"}',
      ),
    ).toBe('ses_e');
  });

  it('无法解析的形态返回 undefined', () => {
    expect(resolveSubagentSessionIdFromToolOutput(undefined)).toBeUndefined();
    expect(resolveSubagentSessionIdFromToolOutput({ sessionId: '   ' })).toBeUndefined();
    expect(resolveSubagentSessionIdFromToolOutput(['ses_x'])).toBeUndefined();
  });
});
