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
 *   - taskProfile：任务画像（kind + surface）
 *   - assignedMember：按 workspace 默认 roster 选中的具体人物槽位
 *   - dependsOn：依赖的 handoff ID 列表（g 依赖 e+f 全部完成）
 *   - priority：优先级（high / medium / low）
 */

import { z } from 'zod';
import { DEFAULT_FIXED_TEAM_MEMBER_SLOTS, TEAM_RUNTIME_LAYER_ORDER } from '@openAwork/shared';
import type { FixedTeamMemberSlot, TeamMemberSpecialty, TeamRuntimeLayer } from '@openAwork/shared';

export const TASK_KINDS = ['build', 'fix', 'refactor', 'review', 'verify', 'docs'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_SURFACES = [
  'ui',
  'backend',
  'workflow',
  'data',
  'integration',
  'cross-cutting',
] as const;
export type TaskSurface = (typeof TASK_SURFACES)[number];

export const taskProfileSchema = z.object({
  kind: z.enum(TASK_KINDS),
  surface: z.enum(TASK_SURFACES),
});

export type TaskProfile = z.infer<typeof taskProfileSchema>;

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

const TEAM_MEMBER_SPECIALTY_VALUES = Array.from(
  new Set<TeamMemberSpecialty>([
    ...DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.specialty),
    'custom',
  ]),
) as [TeamMemberSpecialty, ...TeamMemberSpecialty[]];

export const assignedMemberSchema = z.object({
  id: z.string().min(1).max(120),
  layer: z.enum(TEAM_RUNTIME_LAYER_ORDER),
  specialty: z.enum(TEAM_MEMBER_SPECIALTY_VALUES),
  displayName: z.string().min(1).max(200),
  personaKey: z.string().min(1).max(160),
  toolsets: z.array(z.string().min(1).max(80)).max(20),
  required: z.boolean(),
});

export type AssignedMember = z.infer<typeof assignedMemberSchema>;

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
  taskProfile: taskProfileSchema,
  assignedMember: assignedMemberSchema.optional(),
  dependsOn: z.array(z.string()).default([]),
});

export type DispatchPackage = z.infer<typeof dispatchPackageSchema>;

function roleToTargetLayer(role: DispatchPackage['role']): TeamRuntimeLayer {
  return role === 'reviewer' ? 'reviewer' : 'executor';
}

function cloneAssignedMember(slot: FixedTeamMemberSlot): AssignedMember {
  return {
    id: slot.id,
    layer: slot.layer,
    specialty: slot.specialty,
    displayName: slot.displayName,
    personaKey: slot.personaKey,
    toolsets: [...slot.toolsets],
    required: slot.required,
  };
}

function collectTextSpecialtyPreferences(
  parts: Array<string | null | undefined>,
): TeamMemberSpecialty[] {
  const texts = normalizeTaskText(parts);
  const preferences: TeamMemberSpecialty[] = [];
  for (const [specialty, patterns] of TEXT_SPECIALTY_KEYWORDS) {
    if (texts.some((part) => patterns.some((pattern) => pattern.test(part.text)))) {
      preferences.push(specialty);
    }
  }
  return preferences;
}

function dedupeSpecialties(values: readonly TeamMemberSpecialty[]): TeamMemberSpecialty[] {
  const seen = new Set<TeamMemberSpecialty>();
  const result: TeamMemberSpecialty[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function buildSpecialtyPreferences(input: {
  context?: string | null;
  goal: string;
  profile: TaskProfile;
  story?: string | null;
}): TeamMemberSpecialty[] {
  return dedupeSpecialties([
    ...collectTextSpecialtyPreferences([input.goal, input.story ?? null, input.context ?? null]),
    ...KIND_SPECIALTY_PREFERENCES[input.profile.kind],
    ...SURFACE_SPECIALTY_PREFERENCES[input.profile.surface],
  ]);
}

function scoreMemberSlot(input: {
  slot: FixedTeamMemberSlot;
  preferredSpecialties: readonly TeamMemberSpecialty[];
  targetLayer: TeamRuntimeLayer;
  /** 已小写化的任务文本（goal / story / context），用于成员自定义路由关键词匹配。 */
  taskTexts: readonly string[];
}): number {
  let score = input.slot.layer === input.targetLayer ? 100 : 0;
  const specialtyIndex = input.preferredSpecialties.indexOf(input.slot.specialty);
  if (specialtyIndex >= 0) {
    score += 60 - specialtyIndex;
  }
  // 动态识别：成员自填的 routingKeywords 命中任务文本时加分。让自定义角色
  // （specialty='custom' 不在预置关键词表里）也能被「上游」按专长动态匹配到。
  // 用户显式声明的关键词是强信号：每命中一个 +40（封顶 +120），命中 2 个即可
  // 盖过预置 specialty 匹配（最高 +60），从而把"明确擅长此事"的角色排到最前。
  const keywords = input.slot.routingKeywords;
  if (keywords && keywords.length > 0 && input.taskTexts.length > 0) {
    let hits = 0;
    for (const raw of keywords) {
      const kw = raw.trim().toLowerCase();
      // 至少 2 个字符才算有效路由信号：单字符（如 "a" / "的"）几乎匹配任何任务文本，
      // 会让该成员「截胡」所有任务，破坏派发公平性 —— 直接忽略过短关键词。
      if (kw.length < 2) continue;
      if (input.taskTexts.some((text) => text.includes(kw))) hits += 1;
    }
    if (hits > 0) score += Math.min(120, hits * 40);
  }
  return score;
}

export function resolveAssignedMember(input: {
  context?: string | null;
  goal: string;
  profile: TaskProfile;
  role: DispatchPackage['role'];
  roster?: FixedTeamMemberSlot[];
  story?: string | null;
}): AssignedMember | undefined {
  const roster = input.roster?.filter((slot) => slot.layer === roleToTargetLayer(input.role)) ?? [];
  if (roster.length === 0) return undefined;

  const preferredSpecialties = buildSpecialtyPreferences(input);
  const taskTexts = [input.goal, input.story ?? null, input.context ?? null]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.toLowerCase());
  const [best] = roster
    .map((slot, index) => ({
      index,
      score: scoreMemberSlot({
        slot,
        preferredSpecialties,
        targetLayer: roleToTargetLayer(input.role),
        taskTexts,
      }),
      slot,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      // 同分时按派发优先级（high > normal > low）排序。
      const pr = (s: FixedTeamMemberSlot): number =>
        s.dispatchPriority === 'high' ? 2 : s.dispatchPriority === 'low' ? 0 : 1;
      if (pr(right.slot) !== pr(left.slot)) return pr(right.slot) - pr(left.slot);
      if (Number(right.slot.required) !== Number(left.slot.required)) {
        return Number(right.slot.required) - Number(left.slot.required);
      }
      return left.index - right.index;
    });

  return best ? cloneAssignedMember(best.slot) : undefined;
}

const KIND_HINTS: Readonly<Record<TaskKind, string>> = {
  build: '这是实现任务。优先给出最小可交付实现，避免过度抽象。',
  fix: '这是 bug 修复任务。先复现问题，再定位根因，最后做最小修复并补回归测试。',
  refactor: '这是重构任务。默认保持行为不变，优先清晰边界和最小改动。',
  review: '这是代码评审任务。重点输出问题清单、证据、严重度和建议。',
  verify: '这是验证/测试任务。优先补测试、复现失败路径并验证修复。',
  docs: '这是文档任务。面向读者组织结构，保持术语统一、示例清晰。',
};

const SURFACE_HINTS: Readonly<Record<TaskSurface, string>> = {
  ui: '前端关注：交互状态、响应式、可访问性、设计 token。',
  backend: '后端关注：接口契约、校验、错误处理、鉴权、幂等。',
  workflow: '工作流关注：状态机、handoff、依赖、取消/重试、流转正确性。',
  data: '数据关注：schema、迁移、索引、持久化、回滚。',
  integration: '集成关注：外部 API、MCP/LSP/Channel/Sidecar 交互、超时和重试。',
  'cross-cutting': '跨切面任务：优先识别依赖顺序与副作用，避免一次改太多面。',
};

const KIND_SPECIALTY_PREFERENCES: Readonly<Record<TaskKind, readonly TeamMemberSpecialty[]>> = {
  build: [],
  fix: [],
  refactor: [],
  review: ['code-review', 'quality'],
  verify: ['qa', 'quality'],
  docs: ['docs'],
};

const SURFACE_SPECIALTY_PREFERENCES: Readonly<Record<TaskSurface, readonly TeamMemberSpecialty[]>> =
  {
    ui: ['frontend'],
    backend: ['backend'],
    workflow: ['workflow'],
    data: ['data'],
    integration: ['integration'],
    'cross-cutting': ['platform', 'devops'],
  };

const TEXT_SPECIALTY_KEYWORDS: ReadonlyArray<[TeamMemberSpecialty, RegExp[]]> = [
  ['security', [/安全/, /鉴权/, /权限/, /auth/i, /security/i]],
  ['observability', [/可观测/, /日志/, /指标/, /trace/i, /metric/i, /logging/i]],
  ['sre', [/运维/, /稳定性/, /告警/, /sre/i, /incident/i]],
  ['devops', [/部署/, /发布/, /流水线/, /ci\b/i, /cd\b/i, /deploy/i, /release/i, /devops/i]],
  ['platform', [/平台/, /基础设施/, /infra/i, /platform/i]],
  ['qa', [/测试/, /验证/, /回归/, /e2e/i, /test/i]],
  ['docs', [/文档/, /说明/, /指南/, /readme/i, /docs?/i]],
  ['frontend', [/前端/, /页面/, /界面/, /组件/, /样式/, /ui\b/i, /react/i]],
  ['backend', [/后端/, /接口/, /路由/, /服务端/, /gateway/i, /api\b/i, /server/i]],
  ['data', [/数据库/, /持久化/, /迁移/, /schema/i, /sqlite/i, /postgres/i, /redis/i]],
  ['workflow', [/工作流/, /派发/, /编排/, /状态机/, /handoff/i, /workflow/i]],
  ['integration', [/集成/, /webhook/i, /mcp/i, /lsp/i, /channel/i, /sidecar/i]],
];

const TASK_KIND_KEYWORDS: ReadonlyArray<[TaskKind, RegExp[]]> = [
  ['review', [/\breview\b/i, /评审/, /审查/, /审阅/, /质量检查/, /\bcode review\b/i]],
  [
    'verify',
    [
      /\bverify\b/i,
      /\btest(s|ing)?\b/i,
      /测试/,
      /验证/,
      /验收/,
      /回归/,
      /单测/,
      /单元测试/,
      /集成测试/,
      /\be2e\b/i,
    ],
  ],
  ['docs', [/\bdocs?\b/i, /文档/, /说明/, /手册/, /指南/, /\breadme\b/i]],
  [
    'fix',
    [/\bfix\b/i, /\bbug\b/i, /修复/, /修正/, /报错/, /异常/, /故障/, /错误/, /崩溃/, /\bissue\b/i],
  ],
  ['refactor', [/\brefactor\b/i, /重构/, /拆分/, /梳理/, /整理/, /\bcleanup\b/i]],
  [
    'build',
    [
      /\bimplement(ed|ing)?\b/i,
      /\bbuild\b/i,
      /实现/,
      /新增/,
      /添加/,
      /开发/,
      /接入/,
      /落地/,
      /功能/,
      /\bfeature\b/i,
    ],
  ],
];

const TASK_SURFACE_KEYWORDS: ReadonlyArray<[TaskSurface, RegExp[]]> = [
  [
    'ui',
    [
      /\bui\b/i,
      /前端/,
      /页面/,
      /界面/,
      /组件/,
      /样式/,
      /布局/,
      /交互/,
      /\ba11y\b/i,
      /响应式/,
      /视觉/,
    ],
  ],
  [
    'workflow',
    [
      /\bworkflow\b/i,
      /工作流/,
      /\bhandoff\b/i,
      /派发/,
      /编排/,
      /状态机/,
      /\bsubstate\b/i,
      /\bclaim\b/i,
      /\bscheduler\b/i,
      /\borchestrator\b/i,
      /\bpm1\b/i,
      /\bpm2\b/i,
    ],
  ],
  [
    'data',
    [
      /\bdata\b/i,
      /数据库/,
      /\bdb\b/i,
      /\bschema\b/i,
      /\bmigration\b/i,
      /索引/,
      /表结构/,
      /持久化/,
      /存储/,
      /\bsqlite\b/i,
      /\bpostgres\b/i,
      /\bredis\b/i,
    ],
  ],
  [
    'integration',
    [
      /\bintegration\b/i,
      /集成/,
      /\bmcp\b/i,
      /\blsp\b/i,
      /\bchannel\b/i,
      /\bwebhook\b/i,
      /\bsidecar\b/i,
      /\bprovider\b/i,
      /\badapter\b/i,
      /\bbridge\b/i,
      /\boauth\b/i,
      /\bplugin\b/i,
    ],
  ],
  [
    'backend',
    [
      /\bbackend\b/i,
      /后端/,
      /\bapi\b/i,
      /接口/,
      /路由/,
      /\bservice\b/i,
      /\bhandler\b/i,
      /\bcontroller\b/i,
      /\bgateway\b/i,
      /\bserver\b/i,
      /\bauth\b/i,
      /鉴权/,
      /\bsession\b/i,
      /\bstream\b/i,
      /\bws\b/i,
      /\bhttp\b/i,
    ],
  ],
];

type WeightedText = { text: string; weight: number };

function normalizeTaskText(parts: Array<string | null | undefined>): WeightedText[] {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((text, index) => ({
      text: text.toLowerCase(),
      weight: index === 0 ? 3 : index === 1 ? 2 : 1,
    }));
}

function pickCategory<T extends string>(
  texts: WeightedText[],
  entries: ReadonlyArray<[T, RegExp[]]>,
  fallback: T,
): T {
  let bestValue = fallback;
  let bestScore = 0;

  for (const [value, patterns] of entries) {
    let score = 0;
    for (const part of texts) {
      if (patterns.some((pattern) => pattern.test(part.text))) {
        score += part.weight;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestValue = value;
    }
  }

  return bestValue;
}

export function inferTaskKind(input: {
  title: string;
  context?: string | null;
  story?: string | null;
}): TaskKind {
  const texts = normalizeTaskText([input.title, input.story ?? null, input.context ?? null]);
  return pickCategory(texts, TASK_KIND_KEYWORDS, 'build');
}

export function inferTaskSurface(input: {
  title: string;
  context?: string | null;
  story?: string | null;
}): TaskSurface {
  const texts = normalizeTaskText([input.title, input.story ?? null, input.context ?? null]);
  return pickCategory(texts, TASK_SURFACE_KEYWORDS, 'cross-cutting');
}

export function inferTaskProfile(input: {
  title: string;
  context?: string | null;
  story?: string | null;
}): TaskProfile {
  return {
    kind: inferTaskKind(input),
    surface: inferTaskSurface(input),
  };
}

export function buildTaskProfilePromptFragment(profile: TaskProfile): string {
  return [
    `【任务画像】类型：${profile.kind}；领域：${profile.surface}`,
    `- ${KIND_HINTS[profile.kind]}`,
    `- ${SURFACE_HINTS[profile.surface]}`,
  ].join('\n');
}

/**
 * 从 tasks.md 的一行任务文本中提取标记。
 *
 * 格式：`- [ ] T001 [P] [US1] 描述文本`
 */
export function parseTaskLine(line: string): {
  taskId: string;
  parallel: boolean;
  story: string | null;
  explicitProfile: TaskProfile | null;
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
  const kindMatch = /\[KIND:([A-Z-]+)\]/i.exec(rest);
  const surfaceMatch = /\[SURFACE:([A-Z-]+)\]/i.exec(rest);
  const explicitProfile = parseExplicitTaskProfile(kindMatch?.[1], surfaceMatch?.[1]);

  // 移除标记后剩余的就是标题
  const title = rest
    .replace(/\[P\]/gi, '')
    .replace(/\[US\d+\]/gi, '')
    .replace(/\[KIND:[^\]]+\]/gi, '')
    .replace(/\[SURFACE:[^\]]+\]/gi, '')
    .trim();

  // 优先级推导：高优先级任务通常在 Phase 1/2，或标记为 high
  let priority: 'high' | 'medium' | 'low' = 'medium';
  if (/high|critical|阻塞|blocking/i.test(rest)) priority = 'high';
  if (/low|optional|nice.to.have/i.test(rest)) priority = 'low';

  return { taskId, parallel, story, explicitProfile, title, priority };
}

function parseExplicitTaskProfile(
  rawKind: string | undefined,
  rawSurface: string | undefined,
): TaskProfile | null {
  if (!rawKind || !rawSurface) {
    return null;
  }
  const result = taskProfileSchema.safeParse({
    kind: rawKind.toLowerCase(),
    surface: rawSurface.toLowerCase(),
  });
  return result.success ? result.data : null;
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

function isStructuredTaskTitle(title: string): boolean {
  return /^\[[^\]\n]+\]\s+.+\s+-\s+.+$/.test(title.trim());
}

export function validateParsedTasks(tasks: Array<NonNullable<ReturnType<typeof parseTaskLine>>>): string[] {
  const issues: string[] = [];
  if (tasks.length === 0) {
    issues.push('tasks.md 中未找到任何任务');
    return issues;
  }
  for (const task of tasks) {
    if (!isStructuredTaskTitle(task.title)) {
      issues.push(
        `${task.taskId} 任务标题不符合“[文件/模块路径] 动作 - 预期结果”格式：${task.title || '（空）'}`,
      );
    }
    if (/^(未命名任务|待补充|todo|tbd|无标题|暂无)$/i.test(task.title.trim())) {
      issues.push(`${task.taskId} 任务标题过于模糊：${task.title}`);
    }
  }
  return issues;
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
  assignedMemberRoster?: FixedTeamMemberSlot[];
  executorToolsets?: ToolsetCategory[];
  reviewerToolsets?: ToolsetCategory[];
  /**
   * Hard cap on how many dispatch packages (= child handoffs) are produced.
   * tasks.md is generated by an upstream LLM (PM1), so a runaway / hostile
   * plan with hundreds of `- [ ] T00N` lines would otherwise fan out into
   * unbounded child handoffs -> child sessions, exhausting PIDs / FDs / DB
   * rows / LLM budget. When the parsed task count exceeds the cap, only the
   * first `maxPackages` tasks (in document order, preserving the dependency
   * prefix) are dispatched. `<= 0` / undefined disables the cap.
   */
  maxPackages?: number;
}): DispatchPackage[] {
  const validationIssues = validateParsedTasks(input.tasks);
  if (validationIssues.length > 0) {
    // 不抛异常——返回空数组让 PM2 的空派发降级逻辑接管（退回 PM1 或创建综合任务）
    console.warn(`[dispatch-package] tasks.md 校验问题：${validationIssues.join('；')}`);
    return [];
  }
  const packages: DispatchPackage[] = [];
  let lastNonParallelHandoffId: string | null = null;

  const cappedTasks =
    typeof input.maxPackages === 'number' && input.maxPackages > 0
      ? input.tasks.slice(0, input.maxPackages)
      : input.tasks;

  for (const task of cappedTasks) {
    const taskProfile =
      task.explicitProfile ??
      inferTaskProfile({
        title: task.title,
        context: input.context,
        story: task.story,
      });
    const role: DispatchPackage['role'] = taskProfile.kind === 'review' ? 'reviewer' : 'executor';
    const toolsets: ToolsetCategory[] =
      role === 'reviewer'
        ? (input.reviewerToolsets ?? ['read', 'lsp', 'review'])
        : (input.executorToolsets ?? ['read', 'write', 'shell', 'lsp', 'test']);

    const dependsOn: string[] = [];
    if (!task.parallel && lastNonParallelHandoffId) {
      dependsOn.push(lastNonParallelHandoffId);
    }
    // reviewer 依赖所有前面的 executor 任务
    if (role === 'reviewer') {
      for (const prev of packages) {
        if (prev.role === 'executor') {
          dependsOn.push(prev.taskMarkers.taskId);
        }
      }
    }
    const assignedMember = resolveAssignedMember({
      context: input.context,
      goal: task.title,
      profile: taskProfile,
      role,
      roster: input.assignedMemberRoster,
      story: task.story,
    });

    const pkg: DispatchPackage = {
      goal: task.title,
      context: input.context,
      toolsets,
      role,
      artifactRefs: input.artifactRefs,
      taskProfile,
      taskMarkers: {
        taskId: task.taskId,
        parallel: task.parallel,
        story: task.story ?? undefined,
        priority: task.priority,
      },
      ...(assignedMember ? { assignedMember } : {}),
      dependsOn,
    };
    packages.push(pkg);

    if (!task.parallel) {
      lastNonParallelHandoffId = task.taskId;
    }
  }

  return packages;
}
