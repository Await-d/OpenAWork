import { extractComparablePathsFromText, parseAllTasks } from './dispatch-package.js';

export interface ValidationRule {
  name: string;
  check: (content: string) => boolean;
  patch?: (content: string) => string;
}

export const SPEC_VALIDATION_RULES: ValidationRule[] = [
  {
    name: '包含用户故事',
    check: (c) => /###\s*用户故事\s*\d+/i.test(c),
    patch: (c) =>
      c +
      '\n\n### 用户故事 1 — [待补充]\n\n（LLM 未按格式输出用户故事，此为程序化兜底占位。请在后续评审中细化。）\n',
  },
  {
    name: '包含验收场景',
    check: (c) => /\*\*验收场景\*\*/.test(c) && /给定.+当.+则/s.test(c),
    patch: (c) =>
      c +
      '\n\n**验收场景**：\n\n1. **给定** 系统处于初始状态，**当** 用户执行操作，**则** 系统返回预期结果\n',
  },
  {
    name: '包含边界情况',
    check: (c) => /###\s*边界情况/.test(c),
    patch: (c) =>
      c +
      '\n\n### 边界情况\n\n- 当输入为空时，系统应给出友好提示\n- 当网络异常时，系统应降级处理\n',
  },
  {
    name: '包含验收场景覆盖矩阵',
    check: (c) => /##\s*验收场景覆盖矩阵/.test(c) && /\|\s*用户故事\s*\|\s*场景编号\s*\|/.test(c),
    patch: (c) =>
      c +
      '\n\n## 验收场景覆盖矩阵\n\n| 用户故事 | 场景编号 | 场景摘要 | 对应需求 | 预期验证方式 | 预期证据 |\n|----------|----------|----------|----------|--------------|----------|\n| US1 | AC-1 | 主流程验证 | FR-001 | API 测试 | 响应断言 |\n',
  },
  {
    name: '包含需求',
    check: (c) => /FR-\d+/i.test(c),
    patch: (c) => c + '\n\n## 需求\n\n- **FR-001**：系统必须支持核心功能\n',
  },
  {
    name: '包含成功标准',
    check: (c) => /SC-\d+/i.test(c),
    patch: (c) =>
      c +
      '\n\n## 成功标准\n\n- **SC-001**：核心功能在 3 秒内返回响应\n- **SC-002**：错误率低于 1%\n',
  },
];

export const PLAN_VALIDATION_RULES: ValidationRule[] = [
  {
    name: '包含技术上下文',
    check: (c) => /##\s*技术上下文/.test(c),
    patch: (c) =>
      c +
      '\n\n## 技术上下文\n\n**语言/版本**：TypeScript（strict，NodeNext）\n**主要依赖**：见项目 package.json\n**存储**：SQLite\n**测试**：Vitest\n',
  },
  {
    name: '包含宪法对齐',
    check: (c) => /##\s*宪法对齐检查/.test(c) && /\|\s*宪法条目\s*\|/.test(c),
    patch: (c) =>
      c +
      '\n\n## 宪法对齐检查\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|----------|---------------|------|\n| 无宪法（未设置） | ✅ | 当前团队工作区未配置 constitution_md |\n',
  },
  {
    name: '包含项目结构',
    check: (c) => /##\s*项目结构/.test(c) && /```text[\s\S]+```/.test(c),
    patch: (c) => c + '\n\n## 项目结构\n\n```text\n[待补充——请在后续评审中细化文件路径]\n```\n',
  },
  {
    name: '包含复杂度评估',
    check: (c) => /##\s*复杂度评估/.test(c),
    patch: (c) =>
      c +
      '\n\n## 复杂度评估\n\n| 维度 | 评估 |\n|------|------|\n| 影响文件数 | 待评估 |\n| 新增模块数 | 待评估 |\n| 是否涉及 DB schema | 待评估 |\n',
  },
  {
    name: '包含风险与缓解',
    check: (c) => /##\s*风险与缓解/.test(c) && /\|\s*风险\s*\|\s*缓解措施\s*\|/.test(c),
    patch: (c) =>
      c + '\n\n## 风险与缓解\n\n| 风险 | 缓解措施 |\n|------|----------|\n| 待评估 | 待补充 |\n',
  },
  {
    name: '包含验收场景实施映射',
    check: (c) =>
      /##\s*验收场景实施映射/.test(c) && /\|\s*场景编号\s*\|\s*实现模块\/文件\s*\|/.test(c),
    patch: (c) =>
      c +
      '\n\n## 验收场景实施映射\n\n| 场景编号 | 实现模块/文件 | 分层路径 | 验证方式 | 交付证据 |\n|----------|---------------|----------|----------|----------|\n| AC-1 | 待补充 | 待补充 | 测试 | 断言 |\n',
  },
  {
    name: '包含架构守卫',
    check: (c) => /##\s*架构守卫/.test(c),
    patch: (c) =>
      c +
      '\n\n## 架构守卫\n\n- 数据访问只能通过 store/repository 层\n- 前端访问网关只能通过 @openAwork/web-client\n',
  },
];

export const TASKS_VALIDATION_RULES: ValidationRule[] = [
  {
    name: '包含任务列表',
    check: (c) => /\[[ x]\]\s*T\d+|Phase \d|阶段/i.test(c),
    patch: (c) =>
      c +
      '\n\n## Phase 1: 基础设施\n\n- [ ] T001 [KIND:build] [SURFACE:cross-cutting] [src/index.ts] 实现入口模块 - 系统可启动\n',
  },
  {
    name: '任务包含文件路径格式',
    check: (c) => /^-\s*\[[ x]\]\s*T\d+.*\[[^\]\n]+\]\s+.+\s+-\s+.+$/m.test(c),
    patch: (c) =>
      c +
      '\n- [ ] T099 [KIND:build] [SURFACE:cross-cutting] [src/index.ts] 实现入口模块 - 系统可启动\n',
  },
  {
    name: '任务包含文件清单',
    check: (c) => {
      const tasks = parseAllTasks(c);
      return tasks.length > 0 && tasks.every((task) => task.fileEntries.length > 0);
    },
    patch: (c) => {
      const lines = c.split('\n');
      const patched: string[] = [];

      const inferChecklistLines = (taskLine: string): string[] => {
        const paths = extractComparablePathsFromText(taskLine);
        if (paths.length === 0) {
          return ['**文件**：', '- Modify: `src/index.ts`'];
        }
        return [
          '**文件**：',
          ...paths.map((path) =>
            /\.test\.[A-Za-z0-9_-]+$/i.test(path) ? `- Test: \`${path}\`` : `- Modify: \`${path}\``,
          ),
        ];
      };

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        patched.push(line);
        if (!/^\s*-\s*\[[ x]\]\s*T\d+/i.test(line)) {
          continue;
        }

        let probe = index + 1;
        let hasChecklist = false;
        while (probe < lines.length) {
          const next = lines[probe] ?? '';
          const trimmed = next.trim();
          if (/^\s*-\s*\[[ x]\]\s*T\d+/i.test(next)) break;
          if (/^##\s*Phase\b/i.test(trimmed)) break;
          if (/^\*\*检查点\*\*/.test(trimmed)) break;
          if (/^---$/.test(trimmed)) break;
          if (/^\*\*文件\*\*/.test(trimmed) || /^-\s*(Create|Modify|Test):\s*`/.test(trimmed)) {
            hasChecklist = true;
          }
          probe += 1;
        }

        if (!hasChecklist) {
          patched.push(...inferChecklistLines(line));
        }
      }

      return patched.join('\n');
    },
  },
  {
    name: '任务包含 KIND 标记',
    check: (c) => /\[KIND:[^\]]+\]/.test(c),
    patch: (c) => c + '\n\n<!-- 兜底 KIND 标记：[KIND:build] -->\n',
  },
  {
    name: '任务包含 SURFACE 标记',
    check: (c) => /\[SURFACE:[^\]]+\]/.test(c),
    patch: (c) => c + '\n\n<!-- 兜底 SURFACE 标记：[SURFACE:cross-cutting] -->\n',
  },
  {
    name: '任务包含检查点',
    check: (c) => /\*\*检查点\*\*/.test(c),
    patch: (c) => c + '\n\n**检查点**：所有任务可独立验证\n',
  },
];

export function validateSpecOutput(content: string): { ok: boolean; failed: string[] } {
  return validateOutput(content, SPEC_VALIDATION_RULES);
}

export function validatePlanOutput(content: string): { ok: boolean; failed: string[] } {
  return validateOutput(content, PLAN_VALIDATION_RULES);
}

export function validateTasksOutput(content: string): { ok: boolean; failed: string[] } {
  return validateOutput(content, TASKS_VALIDATION_RULES);
}

export function validateOutput(
  content: string,
  rules: readonly ValidationRule[],
): { ok: boolean; failed: string[] } {
  const failed = rules.filter((r) => !r.check(content)).map((r) => r.name);
  return { ok: failed.length === 0, failed };
}
