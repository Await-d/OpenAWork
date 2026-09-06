import { describe, expect, it } from 'vitest';
import {
  validatePlanOutput,
  validateSpecOutput,
  validateTasksOutput,
} from '../../handoff/runner/artifact-chain.js';
import { parseAllTasks, validateParsedTasks } from '../../handoff/capability/dispatch-package.js';

describe('planning contract validators', () => {
  it('共享校验拒绝同一文件的两个执行任务', () => {
    const tasks =
      parseAllTasks(`- [ ] T001 [KIND:build] [SURFACE:backend] [src/index.ts] 实现入口 - 服务启动
**文件**：
- Modify: \`src/index.ts\`
- [ ] T099 [KIND:build] [SURFACE:backend] [src/index.ts] 实现入口 - 服务启动
**文件**：
- Modify: \`src/index.ts\``);
    expect(validateParsedTasks(tasks).join(';')).toContain('应合并为一个任务');
  });
  it('会拒绝缺少验收覆盖矩阵的 spec', () => {
    const result = validateSpecOutput(
      `# 功能规格：点餐\n\n### 用户故事 1\n\n**验收场景**：\n1. **给定** A，**当** B，**则** C\n\n### 边界情况\n- 网络错误\n\n## 需求\n- **FR-001**：系统必须下单\n\n## 成功标准\n- **SC-001**：成功`,
    );
    expect(result.ok).toBe(false);
    expect(result.failed).toContain('包含验收场景覆盖矩阵');
  });

  it('会拒绝缺少实施映射的 plan', () => {
    const result = validatePlanOutput(
      `# 实施计划：点餐\n\n## 技术上下文\nTypeScript\n\n## 宪法对齐检查\n| 宪法条目 | 本计划是否符合 | 备注 |\n|---|---|---|\n| 禁止直连 DB | ✅ | 通过 |\n\n## 项目结构\n\n\`\`\`text\nservices/...\n\`\`\`\n\n## 复杂度评估\n| 维度 | 评估 |\n|---|---|\n| 影响文件数 | 3 |\n\n## 风险与缓解\n| 风险 | 缓解措施 |\n|---|---|\n| 网络失败 | 重试 |`,
    );
    expect(result.ok).toBe(false);
    expect(result.failed).toContain('包含验收场景实施映射');
  });

  it('会拒绝未带路径与结果的 tasks 标题', () => {
    const tasksContent = `# 任务清单：点餐\n\n## Phase 1\n- [ ] T001 [KIND:build] [SURFACE:backend] 未命名任务\n\n**检查点**：完成`;
    const validation = validateTasksOutput(tasksContent);
    expect(validation.ok).toBe(false);

    const parsed = parseAllTasks(tasksContent);
    const issues = validateParsedTasks(parsed);
    expect(issues.some((issue) => issue.includes('未命名任务'))).toBe(true);
  });

  it('会拒绝缺少文件清单的 tasks', () => {
    const tasksContent = `# 任务清单：点餐

## Phase 1
- [ ] T001 [KIND:build] [SURFACE:backend] [services/agent-gateway/src/routes/orders.ts] 实现订单接口 - 返回订单详情

**检查点**：完成`;

    const validation = validateTasksOutput(tasksContent);
    expect(validation.ok).toBe(false);
    expect(validation.failed).toContain('任务包含文件清单');
  });
});
