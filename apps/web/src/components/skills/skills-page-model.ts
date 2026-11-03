/**
 * `/skills` 工作台的视图模型。
 *
 * 方案 B 是「左列表 · 中详情 · 右元信息」的主从布局，三个列都需要同一份行数据，
 * 所以把「市场条目 / 本地工作区条目 / 已安装条目」统一映射成 `SkillRow`，
 * 由页面容器一次性算好，列组件只负责渲染（不再各自判断 tab 语义）。
 */

import type { MarketInstalledSkill, MarketSkill, MarketSkillDetail } from '@openAwork/shared-ui';

/** 本地工作区技能在 `MarketSkill` 基础上额外带的字段（结构对 `LocalWorkspaceSkill` 兼容）。 */
interface LocalSkillLike extends MarketSkill {
  dirPath?: string;
  workspaceRelativePath?: string;
}

export interface SkillRow {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  downloads: number;
  verified: boolean;
  /** 该来源是否支持在产品内安装（builtin / 只读源为 false）。 */
  installable: boolean;
  /** 来源标识：注册源 id、`local-workspace`、`local-system:…` 等。 */
  source: string;
  /** 已安装版本；未安装为 null。 */
  installedVersion: string | null;
  /** 远端最新版本；未知为 null。 */
  latestVersion: string | null;
  /** 已安装条目才有启用态。 */
  enabled: boolean | null;
  preinstalled: boolean;
  /** 有可用更新。 */
  hasUpdate: boolean;
  /** 安装 / 重新加载 按钮文案。 */
  actionLabel: string;
  dirPath: string | null;
  workspaceRelativePath: string | null;
  /** 系统目录自动发现的技能（重启时同步）。 */
  systemSourced: boolean;
}

interface MarketRowContext {
  source: string;
  installedVersion: string | null;
  enabled: boolean | null;
  preinstalled: boolean;
}

export function toMarketRow(skill: MarketSkill, ctx: MarketRowContext): SkillRow {
  const installed = ctx.installedVersion !== null;
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    category: skill.category,
    tags: skill.tags ?? [],
    downloads: skill.downloads ?? 0,
    verified: skill.verified ?? false,
    installable: skill.installable !== false,
    source: ctx.source,
    installedVersion: ctx.installedVersion,
    latestVersion: null,
    enabled: ctx.enabled,
    preinstalled: ctx.preinstalled,
    hasUpdate: false,
    // 按钮是**动作**：已安装条目再点即重装（旧版同样可点），所以不写「已安装」这个状态词，
    // 状态由旁边的「已安装 vX」徽章表达。真机走查（2026-11-03）发现原文案有歧义。
    actionLabel: installed ? '重新安装' : '安装',
    dirPath: null,
    workspaceRelativePath: null,
    systemSourced: false,
  };
}

export function toLocalRow(skill: LocalSkillLike, ctx: MarketRowContext): SkillRow {
  const installed = ctx.installedVersion !== null;
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    category: skill.category,
    tags: skill.tags ?? [],
    downloads: skill.downloads ?? 0,
    verified: skill.verified ?? false,
    installable: true,
    source: skill.dirPath ? `local-workspace` : ctx.source,
    installedVersion: ctx.installedVersion,
    latestVersion: null,
    enabled: ctx.enabled,
    preinstalled: false,
    hasUpdate: false,
    actionLabel: installed ? '重新加载' : '安装',
    dirPath: skill.dirPath ?? null,
    workspaceRelativePath: skill.workspaceRelativePath ?? null,
    systemSourced: false,
  };
}

export function toInstalledRow(skill: MarketInstalledSkill): SkillRow {
  const latestVersion = skill.latestVersion ?? skill.version;
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: '',
    category: '',
    tags: [],
    downloads: 0,
    verified: false,
    installable: false,
    source: skill.source,
    installedVersion: skill.version,
    latestVersion,
    enabled: skill.enabled,
    preinstalled: skill.preinstalled ?? false,
    hasUpdate: Boolean(latestVersion && latestVersion !== skill.version),
    actionLabel: '已安装',
    dirPath: null,
    workspaceRelativePath: null,
    systemSourced: skill.source.startsWith('local-system:'),
  };
}

/**
 * 合并「列表行」与「市场详情」用于展示。
 *
 * 归属规则（真机走查 2026-11-03 发现的不一致：本地技能 id 与市场条目同名时，
 * 元信息会显示**市场版本**，而列表显示本地清单版本，看起来像数据串了）：
 *   - 名称 / 版本 / 描述 / 分类 / 标签 / 安装量 / 已验证 → 以**行**为准，行缺失时用详情兜底。
 *     行代表该条目自身的产物：市场条目=市场版本、本地工作区=本地清单版本、
 *     已安装=已装版本；同 id 的市场条目对本地技能来说是**另一件产物**。
 *   - README / 权限 / 作者 / 许可 / 更新日志 → 只有详情有，追加进来。
 */
export function mergeSkillDisplayDetail(
  row: SkillRow,
  detail: MarketSkillDetail | null,
): MarketSkillDetail | null {
  if (!detail) {
    return null;
  }
  return {
    ...detail,
    name: row.name || detail.name,
    version: row.version || detail.version,
    description: row.description || detail.description,
    category: row.category || detail.category,
    tags: row.tags.length > 0 ? row.tags : detail.tags,
    downloads: row.downloads || detail.downloads,
    verified: row.verified || detail.verified,
    installable: row.installable,
  };
}

/** 系统目录来源（`local-system:/home/…/.claude/skills`）压成末两段，避免撑破列表宽度。 */
export function formatSourceLabel(source: string): string {
  if (!source.startsWith('local-system:')) {
    return source;
  }
  const path = source.slice('local-system:'.length);
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 2) {
    return path;
  }
  return `…/${parts.slice(-2).join('/')}`;
}

/** 分页页码（与市场卡片网格同一套折行规则：首尾常驻 + 当前页邻域）。 */
export function buildVisiblePages(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 3) {
    return [1, 2, 3, 4, totalPages];
  }
  if (currentPage >= totalPages - 2) {
    return [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, currentPage - 1, currentPage, currentPage + 1, totalPages];
}
