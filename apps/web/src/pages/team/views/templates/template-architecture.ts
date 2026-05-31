/**
 * 模板页面（v2）共享常量与映射。
 *
 * 与 L1.1（五层架构）+ L1.2A（人物 = visible member slot，不引入 roleLayer）保持一致：
 *   - 模板 = 一份按层分组的成员 roster + 可选元数据（focus / scale / 推荐起步 …）
 *   - 同层不同 specialty 的成员通过 personaKey 在运行时区分
 *   - 创建 session 时，模板的 memberSlots 作为默认花名册写入 session 不可变快照
 *
 * 关联文档：
 *   - docs/architecture/team-architecture-l1-baseline.md §L1.1 / §L1.2A
 *   - packages/shared/src/index.ts → DEFAULT_FIXED_TEAM_MEMBER_SLOTS
 */

import type { TeamMemberSpecialty, TeamRuntimeLayer } from '@openAwork/shared';

/** 五层运行时的展示 metadata。 */
export interface LayerMeta {
  /** 唯一 layer key，与 TEAM_RUNTIME_LAYER_ORDER 对齐。 */
  key: TeamRuntimeLayer;
  /** 用户面前的中文名。 */
  label: string;
  /** 角色定位简述（用在层卡片副标题）。 */
  caption: string;
  /** 主题色（与 design tokens 对齐）。 */
  color: string;
  /** 强调色（用在徽章背景）。 */
  tint: string;
}

export const TEAM_LAYER_META: Record<TeamRuntimeLayer, LayerMeta> = {
  reception: {
    key: 'reception',
    label: '接待层',
    caption: '同步对话 · 路由与陪聊',
    color: 'var(--chart-5)',
    tint: 'color-mix(in oklch, var(--chart-5) 12%, transparent)',
  },
  pm1: {
    key: 'pm1',
    label: 'PM1 规划层',
    caption: 'spec / plan / tasks 多步精炼',
    color: 'var(--accent)',
    tint: 'color-mix(in oklch, var(--accent) 12%, transparent)',
  },
  pm2: {
    key: 'pm2',
    label: 'PM2 管控层',
    caption: 'Constitution Check · 拆分派发',
    color: 'var(--warning)',
    tint: 'color-mix(in oklch, var(--warning) 12%, transparent)',
  },
  executor: {
    key: 'executor',
    label: '执行层',
    caption: '前后端 / DevOps / QA / 文档',
    color: 'var(--aux)',
    tint: 'color-mix(in oklch, var(--aux) 12%, transparent)',
  },
  reviewer: {
    key: 'reviewer',
    label: '评审层',
    caption: '代码 / 安全 / SRE / 质量',
    color: 'var(--danger)',
    tint: 'color-mix(in oklch, var(--danger) 10%, transparent)',
  },
};

/** specialty → 中文名（与 team-default-roster-section 保持一致）。 */
export const SPECIALTY_LABEL: Record<TeamMemberSpecialty, string> = {
  intake: '需求澄清',
  'product-planning': '产品规划',
  'task-planning': '任务拆解',
  'tech-lead': '技术负责人',
  dispatch: '调度派发',
  release: '发布管理',
  frontend: '前端开发',
  backend: '后端开发',
  data: '数据工程',
  workflow: '工作流',
  integration: '集成对接',
  qa: '测试验证',
  docs: '文档输出',
  devops: 'DevOps',
  platform: '平台工程',
  'code-review': '代码评审',
  security: '安全评审',
  sre: 'SRE / 运维',
  observability: '可观测性',
  quality: '质量评审',
  custom: '自定义角色',
};

/** specialty 简短代码，用作徽章上的英文字母前缀。 */
export const SPECIALTY_SHORT: Record<TeamMemberSpecialty, string> = {
  intake: 'IN',
  'product-planning': 'PP',
  'task-planning': 'TP',
  'tech-lead': 'TL',
  dispatch: 'DS',
  release: 'RL',
  frontend: 'FE',
  backend: 'BE',
  data: 'DA',
  workflow: 'WF',
  integration: 'IT',
  qa: 'QA',
  docs: 'DC',
  devops: 'OP',
  platform: 'PL',
  'code-review': 'CR',
  security: 'SE',
  sre: 'SR',
  observability: 'OB',
  quality: 'QL',
  custom: '✨',
};

export const TOOLSET_LABEL: Record<string, string> = {
  read: '只读',
  write: '编辑',
  shell: '执行',
  lsp: 'LSP',
  test: '测试',
  review: '评审',
  web: '联网',
};

/**
 * 每层允许的工具类别「能力天花板」（镜像后端 LAYER_CAPABILITIES.allowedToolsetCategories）。
 *
 * 自定义角色编辑时据此提示 / 限制可勾选的工具：层级白名单之外的工具勾了也会被运行时
 * 的 toolset-gate 过滤掉，所以在 UI 层就标灰禁用，避免用户误配。与后端保持同步。
 */
export const LAYER_ALLOWED_TOOLSETS: Record<TeamRuntimeLayer, readonly string[]> = {
  reception: ['read', 'web'],
  pm1: ['read', 'write'],
  pm2: ['read', 'write', 'shell', 'lsp', 'review'],
  executor: ['read', 'write', 'shell', 'lsp', 'test', 'web'],
  reviewer: ['read', 'lsp', 'review', 'shell', 'test'],
};
