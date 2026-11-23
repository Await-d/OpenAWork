/**
 * stream-auth.ts — 权限检查与会话上下文加载
 *
 * 职责：
 * - 加载会话上下文（元数据、角色层级）
 * - 加载用户信息（邮箱、身份验证）
 * - 验证会话访问权限
 * - 解析会话级 Provider/Agent 选择
 *
 * 依赖：SQLite、auth、metadata 解析器
 * 被依赖：stream-handler（初始化）
 */

import type { JwtPayload } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { sanitizeSessionMetadataJson } from '../session/session-workspace-metadata.js';

/**
 * 会话运行时上下文快照：在每个请求开始时捕获，
 * 用于整轮执行过程中的一致性读。
 */
export interface SessionStreamContext {
  metadataJson: string;
  roleLayer?: string | null;
}

/**
 * 用户会话行记录
 */
interface SessionUserRow {
  email: string;
}

/**
 * 会话级 Provider 和 Agent 选择
 */
export interface SessionProviderSelection {
  /**
   * 会话绑定的 Agent（`metadata.agentId`，客户端会话设置写入、PATCH 白名单内的正式键）。
   *
   * 请求未显式携带 `agentId` 时用它兜底：后台续跑（`continueSessionFromHistory`）、
   * 子代理唤醒、GitHub 事件等轮次都不带请求级 agentId，若不兜底就会丢掉角色提示词。
   */
  agentId?: string;
  /**
   * 会话级上下文窗口挡位（`metadata.contextWindowOverride`）。
   *
   * 存在时**优先于**模型级配置（`user_settings.providers` 里该模型的
   * `contextWindowOverride`），用于让「上下文长度」成为会话级设置而不是全局设置。
   */
  contextWindowOverride?: number;
  delegatedSystemPrompt?: string;
  modelId?: string;
  providerId?: string;
  reasoningEffort?: string;
  systemPrompt?: string;
  thinkingEnabled?: boolean;
  variant?: string;
}

/**
 * 从数据库加载会话上下文（元数据 + 角色层级）
 *
 * @param sessionId - 会话 ID
 * @param userId - 用户 ID
 * @returns 会话上下文或 null 若会话不存在
 */
export function loadSessionContext(sessionId: string, userId: string): SessionStreamContext | null {
  const session = sqliteGet<{ metadata_json: string; role_layer: string | null }>(
    'SELECT metadata_json, role_layer FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  if (!session) return null;
  return {
    metadataJson: sanitizeSessionMetadataJson(session.metadata_json),
    roleLayer: session.role_layer,
  };
}

/**
 * 从数据库加载用户信息（用于 JWT payload 构建）
 *
 * @param sessionId - 会话 ID
 * @param userId - 用户 ID
 * @returns 用户身份信息或 null 若用户不存在
 */
export function loadSessionUser(sessionId: string, userId: string): JwtPayload | null {
  const user = sqliteGet<SessionUserRow>(
    `SELECT u.email
     FROM users u
     JOIN sessions s ON s.user_id = u.id
     WHERE s.id = ? AND u.id = ?
     LIMIT 1`,
    [sessionId, userId],
  );

  if (!user) {
    return null;
  }

  return {
    sub: userId,
    email: user.email,
  };
}

/**
 * 解析会话元数据中的 Provider 和 Agent 选择
 *
 * @param metadataJson - 会话元数据 JSON 字符串
 * @returns Provider 和 Agent 选择对象
 */
export function parseSessionProviderSelection(metadataJson: string): SessionProviderSelection {
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    const channel = parsed['channel'];
    const channelRecord =
      typeof channel === 'object' && channel !== null ? (channel as Record<string, unknown>) : null;
    return {
      agentId: typeof parsed['agentId'] === 'string' ? parsed['agentId'] : undefined,
      providerId:
        typeof parsed['providerId'] === 'string'
          ? parsed['providerId']
          : typeof channelRecord?.['providerId'] === 'string'
            ? channelRecord['providerId']
            : undefined,
      modelId:
        typeof parsed['modelId'] === 'string'
          ? parsed['modelId']
          : typeof channelRecord?.['model'] === 'string'
            ? channelRecord['model']
            : undefined,
      variant:
        typeof parsed['variant'] === 'string'
          ? parsed['variant']
          : typeof channelRecord?.['variant'] === 'string'
            ? channelRecord['variant']
            : undefined,
      delegatedSystemPrompt:
        typeof parsed['delegatedSystemPrompt'] === 'string'
          ? parsed['delegatedSystemPrompt']
          : undefined,
      systemPrompt: typeof parsed['systemPrompt'] === 'string' ? parsed['systemPrompt'] : undefined,
      thinkingEnabled:
        typeof parsed['thinkingEnabled'] === 'boolean' ? parsed['thinkingEnabled'] : undefined,
      reasoningEffort:
        typeof parsed['reasoningEffort'] === 'string' ? parsed['reasoningEffort'] : undefined,
      contextWindowOverride:
        typeof parsed['contextWindowOverride'] === 'number' &&
        Number.isInteger(parsed['contextWindowOverride']) &&
        parsed['contextWindowOverride'] > 0
          ? parsed['contextWindowOverride']
          : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * 从存储的 JSON 字符串安全解析为泛型类型
 *
 * @param value - 可能为 undefined 的 JSON 字符串
 * @returns 解析的对象或 undefined
 */
export function parseStoredJson<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
