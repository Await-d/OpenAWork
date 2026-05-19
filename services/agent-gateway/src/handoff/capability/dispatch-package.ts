/**
 * 260516-team-phase-d · T-01
 *
 * dispatch_package 标准结构定义。
 *
 * 这是 d 层（PM2）向 e/f/g 层派发任务时的标准载荷格式。
 * 存入 handoff_records.payload_json，由 executor/tester/reviewer 层读取。
 *
 * 结构：
 *   - goal：任务目标（一句话）
 *   - context：上下文摘要（来自 plan + spec 的相关段落）
 *   - toolsets：该任务允许使用的工具类别白名单（D43 门控）
 *   - role：目标角色（executor / tester / reviewer）
 *   - artifactRefs：关联的产物 ID（spec / plan / tasks）
 *   - taskMarkers：从 tasks.md 提取的标记（[P] / [US1] 等）
 *   - dependsOn：依赖的 handoff ID 列表（g 依赖 e+f 全部完成）
 *   - priority：优先级（high / medium / low）
 */

import { z } from 'zod';

export const TOOLSET_CATEGORIES = [
  'read', // 文件读取 / grep / glob
  'write', // 文件写入 / edit / apply_patch
  'shell', // bash 执行
  'web', // web_search / fetch
  'lsp', // LSP 语义查询
  'test', // 测试执行
  'review', // 代码审查工具
  'all', // 不限制（仅 reviewer 使用）
] as const;

export type ToolsetCategory = (typeof TOOLSET_CATEGORIES)[number];

export const dispatchPackageSchema = z.object({
  goal: z.string().min(1).max(2000),
  context: z.string().max(8000).default(''),
  toolsets: z.array(z.enum(TOOLSET_CATEGORIES)).min(1).default(['read', 'write', 'shell']),
  role: z.enum(['executor', 'tester', 'reviewer']),
  artifactRefs: z
    .object({
      specId: z.string().optional(),
      planId: z.string().optional(),
      tasksId: z.string().optional(),
    })
    .default({}),
  taskMarkers: z.object({
    taskId: z.string().min(1),
    parallel: z.boolean().default(false),
    story: z.string().optional(),
    priority: z.enum(['high', 'medium', 'low']).default('medium'),
  }),
  dependsOn: z.array(z.string()).default([]),
});

export type DispatchPackage = z.infer<typeof dispatchPackageSchema>;

/**
 * 从 tasks.md 的一行任务文本中提取标记。
 *
 * 格式：`- [ ] T001 [P] [US1] 描述文本`
 */
export function parseTaskLine(line: string): {
  taskId: string;
  parallel: boolean;
  story: string | null;
  title: string;
  priority: 'high' | 'medium' | 'low';
} | null {
  const trimmed = line.trim();
  // 匹配 `- [ ] T001` 或 `- [x] T001`
  const taskMatch = /^-\s*\[[ x]\]\s*(T\d+)\s*(.*)$/i.exec(trimmed);
  if (!taskMatch) return null;

  const taskId = taskMatch[1] ?? '';
  const rest = taskMatch[2] ?? '';

  const parallel = /\[P\]/i.test(rest);
  const storyMatch = /\[(US\d+)\]/i.exec(rest);
  const story = storyMatch?.[1] ?? null;

  // 移除标记后剩余的就是标题
  const title = rest
    .replace(/\[P\]/gi, '')
    .replace(/\[US\d+\]/gi, '')
    .trim();

  // 优先级推导：高优先级任务通常在 Phase 1/2，或标记为 high
  let priority: 'high' | 'medium' | 'low' = 'medium';
  if (/high|critical|阻塞|blocking/i.test(rest)) priority = 'high';
  if (/low|optional|nice.to.have/i.test(rest)) priority = 'low';

  return { taskId, parallel, story, title, priority };
}

/**
 * 从完整 tasks.md 内容中提取所有任务行。
 */
export function parseAllTasks(tasksContent: string): Array<ReturnType<typeof parseTaskLine> & {}> {
  const lines = tasksContent.split('\n');
  const tasks: Array<NonNullable<ReturnType<typeof parseTaskLine>>> = [];
  for (const line of lines) {
    const parsed = parseTaskLine(line);
    if (parsed) tasks.push(parsed);
  }
  return tasks;
}

/**
 * 根据解析出的任务列表，构建 dispatch_packages。
 *
 * 规则：
 *   - 标记 [P] 的任务 → role=executor，可并行
 *   - 未标记 [P] 的任务 → role=executor，串行（dependsOn 前一个）
 *   - 最后一个 phase 的任务如果是 review 相关 → role=reviewer
 */
export function buildDispatchPackages(input: {
  tasks: Array<NonNullable<ReturnType<typeof parseTaskLine>>>;
  artifactRefs: DispatchPackage['artifactRefs'];
  context: string;
  executorToolsets?: ToolsetCategory[];
  reviewerToolsets?: ToolsetCategory[];
}): DispatchPackage[] {
  const packages: DispatchPackage[] = [];
  let lastNonParallelHandoffId: string | null = null;

  for (const task of input.tasks) {
    const isReviewTask = /review|审查|质量/i.test(task.title);
    const role: DispatchPackage['role'] = isReviewTask ? 'reviewer' : 'executor';
    const toolsets: ToolsetCategory[] = isReviewTask
      ? (input.reviewerToolsets ?? ['read', 'lsp', 'review'])
      : (input.executorToolsets ?? ['read', 'write', 'shell', 'lsp', 'test']);

    const dependsOn: string[] = [];
    if (!task.parallel && lastNonParallelHandoffId) {
      dependsOn.push(lastNonParallelHandoffId);
    }
    // reviewer 依赖所有前面的 executor 任务
    if (isReviewTask) {
      for (const prev of packages) {
        if (prev.role === 'executor') {
          dependsOn.push(prev.taskMarkers.taskId);
        }
      }
    }

    const pkg: DispatchPackage = {
      goal: task.title,
      context: input.context,
      toolsets,
      role,
      artifactRefs: input.artifactRefs,
      taskMarkers: {
        taskId: task.taskId,
        parallel: task.parallel,
        story: task.story ?? undefined,
        priority: task.priority,
      },
      dependsOn,
    };
    packages.push(pkg);

    if (!task.parallel) {
      lastNonParallelHandoffId = task.taskId;
    }
  }

  return packages;
}
