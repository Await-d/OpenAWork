/**
 * 会话扩展（Skill / MCP）的**冻结契约**。
 *
 * 本文件是整个「消息渠道对话安装 + 会话隔离」能力的地基：只放类型、常量与
 * 纯判定函数，不依赖 DB / 连接池 / zod，任何层都可以安全导入（尤其是策略层与
 * 可见性层，二者都被大量模块反向引用，不能引入重依赖）。
 *
 * 设计边界（对应方案文档 261031）：
 * - 渠道会话只允许 `scope: 'session'`，用户级变更仍走旧的设置页 / 个人会话路径；
 * - 「仅当前会话生效」与「本会话允许再次调用」是两件事，后者由一次性操作审批
 *   承担，绝不能落成普通的 `session` / `permanent` 授权（否则一次批准等于放行
 *   同类别后续调用）；
 * - 群会话按 chatId 复用，因此会话级扩展对**有使用权限的群成员**共享；
 * - 内置（system）资源单独声明，不得因 `source === 'system'` 绕过显式白名单。
 */

/** 扩展资源的两种归属：会话级（新能力）与用户级（历史行为，保持不变）。 */
export type SessionExtensionScope = 'session' | 'user';

/** 扩展种类。 */
export type SessionExtensionKind = 'skill' | 'mcp';

/**
 * 会话扩展策略版本。版本号落在 `session_extension_settings.policy_version`，
 * 用于将来改变继承语义时区分新旧数据，而不是靠字段缺失猜测。
 */
export const SESSION_EXTENSION_POLICY_VERSION = 1;

/**
 * 继承模式：
 * - `inherit`（历史兼容）：未显式配置时，会话仍继承用户级已启用扩展；
 * - `explicit`：只使用会话自己登记的扩展集合，空集合就是「什么都不继承」。
 *
 * 新开启本能力的**渠道**默认写入 `explicit`；老会话没有该行时按 `inherit`
 * 处理，保证升级不改变既有会话的可见能力。
 */
export type SessionExtensionInheritanceMode = 'inherit' | 'explicit';

export const DEFAULT_SESSION_EXTENSION_INHERITANCE: SessionExtensionInheritanceMode = 'inherit';

/** 单会话可登记的扩展条目上限（防止模型无限堆积）。 */
export const SESSION_EXTENSION_MAX_RESOURCES = 50;

/** 操作（安装提案）默认有效期：10 分钟。 */
export const SESSION_EXTENSION_OPERATION_TTL_MS = 10 * 60 * 1000;

/**
 * 操作状态机。`succeeded` 才是「真的生效了」；`configured_unavailable` 表示
 * 配置已落库但探活失败——绝不能把它当成成功（方案 §MCP 生命周期）。
 */
export type SessionExtensionOperationStatus =
  | 'pending_approval'
  | 'approved'
  | 'applying'
  | 'succeeded'
  | 'configured_unavailable'
  | 'failed'
  | 'rejected'
  | 'expired'
  | 'cancelled';

/** 终态：不再接受任何状态迁移。 */
export const SESSION_EXTENSION_TERMINAL_STATUSES: readonly SessionExtensionOperationStatus[] = [
  'succeeded',
  'configured_unavailable',
  'failed',
  'rejected',
  'expired',
  'cancelled',
];

export function isTerminalExtensionOperationStatus(
  status: SessionExtensionOperationStatus,
): boolean {
  return SESSION_EXTENSION_TERMINAL_STATUSES.includes(status);
}

/** 操作动作。与既有 `skill_manage` / `mcp_manage_servers` 的 action 词表对齐。 */
export type SessionExtensionOperationAction =
  'install' | 'uninstall' | 'enable' | 'disable' | 'add' | 'update' | 'remove';

// ---------------------------------------------------------------------------
// 解耦的扩展条目形态（存储行 → 领域对象的统一表示）
// ---------------------------------------------------------------------------

export interface SessionSkillInstallation {
  readonly resourceRef: string;
  readonly skillId: string;
  readonly sourceId: string;
  readonly version: string | null;
  readonly manifest: unknown;
  readonly contentDigest: string;
  readonly enabled: boolean;
  readonly pinned: boolean;
  readonly revision: number;
}

export interface SessionMcpServerRecord {
  readonly resourceRef: string;
  readonly displayId: string;
  readonly config: unknown;
  /** 凭据引用（非明文）。明文/环境变量永不入库、不回显。 */
  readonly secretRef: string | null;
  readonly enabled: boolean;
  readonly disabledTools: readonly string[];
  readonly revision: number;
}

export interface SessionExtensionSnapshot {
  readonly sessionId: string;
  readonly ownerUserId: string;
  readonly inheritance: SessionExtensionInheritanceMode;
  readonly revision: number;
  readonly skills: readonly SessionSkillInstallation[];
  readonly mcpServers: readonly SessionMcpServerRecord[];
}

/**
 * MCP 资源身份：连接池 / 目录缓存 / OAuth grant 的统一键。
 *
 * 必须是**会话级**且无歧义的编码——把 sessionId 编进 key 就能让同一用户的不同
 * 会话各自持有独立客户端与子进程；只给每个 session 一个 ToolRegistry 并不能
 * 隔离 MCP 进程状态。
 */
export function buildSessionMcpResourceIdentity(params: {
  ownerUserId: string;
  sessionId: string;
  resourceRef: string;
  configDigest: string;
}): string {
  return [
    'session-mcp',
    params.ownerUserId,
    params.sessionId,
    params.resourceRef,
    params.configDigest,
  ]
    .map((segment) => encodeURIComponent(segment))
    .join('::');
}

/** 会话技能资源身份（技能内嵌 MCP 复用同一身份链）。 */
export function buildSessionSkillResourceIdentity(params: {
  ownerUserId: string;
  sessionId: string;
  resourceRef: string;
  contentDigest: string;
}): string {
  return [
    'session-skill',
    params.ownerUserId,
    params.sessionId,
    params.resourceRef,
    params.contentDigest,
  ]
    .map((segment) => encodeURIComponent(segment))
    .join('::');
}

/**
 * 会话级资源引用。用户级技能可能与会话级技能同名，因此引用必须带 `session:` 前缀
 * 才能避免隐式覆盖（方案 §会话资源真相源）。
 */
export function buildSessionResourceRef(kind: SessionExtensionKind, id: string): string {
  return `${kind}:session:${id}`;
}

export function isSessionOwnedResourceRef(resourceRef: string): boolean {
  return resourceRef.includes(':session:');
}
