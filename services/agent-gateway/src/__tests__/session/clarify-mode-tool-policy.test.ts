import { describe, expect, it } from 'vitest';
import { isClarifyModeToolAllowed } from '../../session/clarify-mode-tool-policy.js';

describe('clarify 模式只读工具允许集', () => {
  it('允许只读的 models 工具（模型检索无副作用）', () => {
    expect(isClarifyModeToolAllowed('models')).toBe(true);
  });

  it('仍然允许既有只读工具', () => {
    for (const tool of ['read', 'list', 'glob', 'grep', 'session_list', 'websearch']) {
      expect(isClarifyModeToolAllowed(tool)).toBe(true);
    }
  });

  it('仍然拒绝写/执行类工具与会话管理工具', () => {
    for (const tool of ['write', 'edit', 'bash', 'session_rename', 'session_move']) {
      expect(isClarifyModeToolAllowed(tool)).toBe(false);
    }
  });
});
