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

  /**
   * G-06（261102 修复规范名 subagent 静默漏点）：委派工具的**规范名 `subagent`**
   * 必须与历史别名 `task` / 兼容呈报名 `Agent` 一并放行。
   * 修复前 `subagent` 未登记 → clarify 模式下被判不可见（而 `task` 可见），本断言失败。
   */
  it('委派工具的三个名字（task / subagent / Agent）在 clarify 模式下一致放行', () => {
    expect(isClarifyModeToolAllowed('task')).toBe(true);
    expect(isClarifyModeToolAllowed('subagent')).toBe(true);
    expect(isClarifyModeToolAllowed('Agent')).toBe(true);
    expect(isClarifyModeToolAllowed('subagent')).toBe(isClarifyModeToolAllowed('task'));
  });
});
