import { describe, expect, it } from 'vitest';

import { callOmoAgentToolDefinition } from '../../tools/call-omo-agent-tools.js';

describe('call_omo_agent input schema', () => {
  it('treats an empty optional session_id as omitted', () => {
    const parsed = callOmoAgentToolDefinition.inputSchema.safeParse({
      description: '盘点页面实现情况',
      prompt: '仅检查当前工作区的页面实现，不修改文件。',
      run_in_background: false,
      session_id: '',
      subagent_type: 'explore',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.session_id).toBeUndefined();
    }
  });
});
