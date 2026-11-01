/**
 * 会话扩展（Skill / MCP）的持久化层。
 *
 * 与 `skill/skill-installed-store.ts` 同构：HTTP 路由与 agent 工具必须共用同一套
 * 落库语义，避免两处实现漂移。这里只做「读写 + 并发控制」，不含网络、注册源、
 * 连接池或审批逻辑。
 *
 * 并发控制统一走 `revision`：所有写操作都要求调用方传入 `expectedRevision` 并做
 * CAS（`WHERE revision = ?`）。同一会话被多端 / 多标签页同时编辑时，后到者拿到
 * `undefined` 而不是静默覆盖（方案 §会话资源真相源）。
 */

import { createHash } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import { resolveSessionExtensionOrigin } from './session-extension-origin.js';
import {
  DEFAULT_SESSION_EXTENSION_INHERITANCE,
  SESSION_EXTENSION_POLICY_VERSION,
  type SessionExtensionInheritanceMode,
  type SessionMcpServerRecord,
  type SessionSkillInstallation,
} from './session-extension-contract.js';

// ---------------------------------------------------------------------------
// 稳定摘要
// ---------------------------------------------------------------------------

/**
 * 规范化 JSON：对象键排序、剔除 `undefined`。
 *
 * digest 必须对「同内容不同书写」稳定——否则配置里的键顺序变化会被误判成新
 * revision，把已经批准的操作变成「审批 A、执行 B」。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) continue;
      sorted[key] = canonicalize(entry);
    }
    return sorted;
  }
  return value;
}

/** 计算配置 / 内容摘要（SHA-256）。调用方负责保证传入值不含明文密钥。 */
export function computeSessionExtensionDigest(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// 设置行
// ---------------------------------------------------------------------------

interface SettingsRow {
  session_id: string;
  user_id: string;
  policy_version: number;
  inheritance_mode: string;
  revision: number;
  updated_at: number;
}

export interface SessionExtensionSettings {
  sessionId: string;
  ownerUserId: string;
  policyVersion: number;
  inheritance: SessionExtensionInheritanceMode;
  revision: number;
  updatedAt: number;
  /** 是否已存在显式设置行；`false` 表示按历史 `inherit` 语义回退。 */
  readonly explicitRow: boolean;
}

function normalizeInheritance(value: string): SessionExtensionInheritanceMode {
  return value === 'explicit' ? 'explicit' : 'inherit';
}

function rowToSettings(row: SettingsRow): SessionExtensionSettings {
  return {
    sessionId: row.session_id,
    ownerUserId: row.user_id,
    policyVersion: row.policy_version,
    inheritance: normalizeInheritance(row.inheritance_mode),
    revision: row.revision,
    updatedAt: row.updated_at,
    explicitRow: true,
  };
}

/**
 * 读取设置；不存在时返回**不发写的**历史语义默认值。
 *
 * 关键：读路径不能顺手 INSERT。渠道每轮都会解析有效扩展，如果读的时候建行，
 * 就会把「从未配置过」也变成显式行，日后无法区分「用户显式选择 inherit」与
 * 「历史缺省」。
 */
export function getSessionExtensionSettings(
  sessionId: string,
): SessionExtensionSettings | undefined {
  const row = sqliteGet<SettingsRow>(
    'SELECT * FROM session_extension_settings WHERE session_id = ? LIMIT 1',
    [sessionId],
  );
  return row ? rowToSettings(row) : undefined;
}

/**
 * 没有设置行时，这个会话该用哪个继承模式。
 *
 * 默认 `inherit` 是**历史语义**（本能力上线前的会话一直继承用户级配置，改成 explicit
 * 会静默丢掉它们已有的技能 / MCP）。但渠道会话是例外：规格要求「新渠道开启本能力时
 * 使用 `explicit` 扩展策略」，否则「渠道级隔离」直接落空——渠道里的一句提示词就能
 * 用上会话所有者的全部用户级配置。
 *
 * 判定依据是 `channelExtensionManagementEnabled` 这个**渠道配置里 owner 显式打开**的
 * 开关：打开它本身就是那次确认动作（本仓目前没有独立的「启用向导」界面）。
 * 一旦写入过设置行，行里的值就是用户显式选择，永久优先于这里的默认。
 */
function resolveDefaultSessionExtensionInheritance(
  sessionId: string,
): SessionExtensionInheritanceMode {
  const origin = resolveSessionExtensionOrigin(sessionId);
  if (!origin || origin.source !== 'channel' || !origin.managementEnabled) {
    return DEFAULT_SESSION_EXTENSION_INHERITANCE;
  }
  return 'explicit';
}

/** 解析有效继承模式：显式设置行优先，其次按来源取默认。 */
export function resolveSessionExtensionInheritance(
  sessionId: string,
): SessionExtensionInheritanceMode {
  return (
    getSessionExtensionSettings(sessionId)?.inheritance ??
    resolveDefaultSessionExtensionInheritance(sessionId)
  );
}

/**
 * 确保设置行存在并返回它。
 *
 * `expectedRevision === undefined` 表示「按需建行」。并发建行由主键冲突兜底
 * （`ON CONFLICT DO NOTHING` 后再读），不会出现两行。
 */
export function ensureSessionExtensionSettings(
  sessionId: string,
  ownerUserId: string,
): SessionExtensionSettings {
  const existing = getSessionExtensionSettings(sessionId);
  if (existing) return existing;

  const now = Date.now();
  sqliteRun(
    `INSERT INTO session_extension_settings
       (session_id, user_id, policy_version, inheritance_mode, revision, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(session_id) DO NOTHING`,
    [
      sessionId,
      ownerUserId,
      SESSION_EXTENSION_POLICY_VERSION,
      // 建行时用同一个来源感知默认值：否则「读」说 explicit、「行」写 inherit，
      // 首次提案之后隔离会被自己建的行反过来打开。
      resolveDefaultSessionExtensionInheritance(sessionId),
      now,
    ],
  );

  const created = getSessionExtensionSettings(sessionId);
  if (!created) {
    throw new Error(`无法为会话 ${sessionId} 建立扩展设置行。`);
  }
  return created;
}

/**
 * CAS 写入继承模式与（可选）revision 自增。
 *
 * 返回 `undefined` 表示 `expectedRevision` 已过期——调用方必须把它当作冲突处理，
 * 而不是重试覆盖。
 */
export function setSessionExtensionInheritance(params: {
  sessionId: string;
  ownerUserId: string;
  inheritance: SessionExtensionInheritanceMode;
  expectedRevision: number;
}): SessionExtensionSettings | undefined {
  const current = getSessionExtensionSettings(params.sessionId);
  if (current) {
    return applyInheritanceCas(current.revision, params);
  }

  // 尚无设置行：`expectedRevision` 必须为 0（=「我基于空状态提交」），
  // 建行时就写入目标继承模式，不能先按默认值建行再走 CAS —— 那会让合法的首次
  // 写入被自己的 revision 自增挡掉。
  if (params.expectedRevision !== 0) return undefined;
  sqliteRun(
    `INSERT INTO session_extension_settings
       (session_id, user_id, policy_version, inheritance_mode, revision, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(session_id) DO NOTHING`,
    [
      params.sessionId,
      params.ownerUserId,
      SESSION_EXTENSION_POLICY_VERSION,
      params.inheritance,
      Date.now(),
    ],
  );
  const created = getSessionExtensionSettings(params.sessionId);
  // 并发下可能已被别人建行（`DO NOTHING`）：此时继承模式以先到者为准，
  // 但若正好与请求一致就当作成功，否则视为冲突。
  if (!created) return undefined;
  return created.inheritance === params.inheritance ? created : undefined;
}

function applyInheritanceCas(
  currentRevision: number,
  params: {
    sessionId: string;
    inheritance: SessionExtensionInheritanceMode;
    expectedRevision: number;
  },
): SessionExtensionSettings | undefined {
  if (currentRevision !== params.expectedRevision) return undefined;
  const nextRevision = currentRevision + 1;
  const before = sqliteGet<{ revision: number }>(
    'SELECT revision FROM session_extension_settings WHERE session_id = ?',
    [params.sessionId],
  );
  if (before?.revision !== params.expectedRevision) return undefined;

  sqliteRun(
    `UPDATE session_extension_settings
        SET inheritance_mode = ?, revision = ?, policy_version = ?, updated_at = ?
      WHERE session_id = ? AND revision = ?`,
    [
      params.inheritance,
      nextRevision,
      SESSION_EXTENSION_POLICY_VERSION,
      Date.now(),
      params.sessionId,
      params.expectedRevision,
    ],
  );
  return getSessionExtensionSettings(params.sessionId);
}

/** 读取当前 revision；无设置行时为 0（表示「还没有任何会话级扩展」）。 */
export function readSessionExtensionRevision(sessionId: string): number {
  return getSessionExtensionSettings(sessionId)?.revision ?? 0;
}

/**
 * 自增 revision。所有扩展条目写操作都必须在事务内调用它，让本轮解析到的快照
 * 与写操作一一对应（`expectedRevision` 冲突检测的依据）。
 */
function bumpRevisionInTransaction(sessionId: string, ownerUserId: string, now: number): number {
  const existing = getSessionExtensionSettings(sessionId);
  if (!existing) {
    sqliteRun(
      `INSERT INTO session_extension_settings
         (session_id, user_id, policy_version, inheritance_mode, revision, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(session_id) DO NOTHING`,
      [
        sessionId,
        ownerUserId,
        SESSION_EXTENSION_POLICY_VERSION,
        // 必须与 `ensureSessionExtensionSettings` 用**同一个**来源感知默认值。
        // 两处都是 `INSERT ... ON CONFLICT DO NOTHING`，先到者决定行内容；曾经这里
        // 写死 `inherit`，渠道会话只要先从写入路径建行，就会把刚生效的 `explicit`
        // 隔离悄悄关掉（正是 `resolveDefaultSessionExtensionInheritance` 存在的理由）。
        resolveDefaultSessionExtensionInheritance(sessionId),
        now,
      ],
    );
    return readSessionExtensionRevision(sessionId);
  }
  const next = existing.revision + 1;
  sqliteRun(
    'UPDATE session_extension_settings SET revision = ?, updated_at = ? WHERE session_id = ?',
    [next, now, sessionId],
  );
  return next;
}

// ---------------------------------------------------------------------------
// 会话技能
// ---------------------------------------------------------------------------

interface SessionSkillRow {
  resource_ref: string;
  skill_id: string;
  source_id: string;
  version: string | null;
  manifest_json: string;
  content_digest: string;
  enabled: number;
  pinned: number;
  revision: number;
}

function rowToSessionSkill(row: SessionSkillRow): SessionSkillInstallation {
  return {
    resourceRef: row.resource_ref,
    skillId: row.skill_id,
    sourceId: row.source_id,
    version: row.version,
    manifest: safeParseJson(row.manifest_json),
    contentDigest: row.content_digest,
    enabled: row.enabled === 1,
    pinned: row.pinned === 1,
    revision: row.revision,
  };
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function listSessionSkills(sessionId: string): SessionSkillInstallation[] {
  const rows = sqliteAll<SessionSkillRow>(
    'SELECT * FROM session_skill_installations WHERE session_id = ? ORDER BY updated_at DESC',
    [sessionId],
  );
  return rows.map(rowToSessionSkill);
}

export function getSessionSkill(
  sessionId: string,
  resourceRef: string,
): SessionSkillInstallation | undefined {
  const row = sqliteGet<SessionSkillRow>(
    'SELECT * FROM session_skill_installations WHERE session_id = ? AND resource_ref = ? LIMIT 1',
    [sessionId, resourceRef],
  );
  return row ? rowToSessionSkill(row) : undefined;
}

export interface UpsertSessionSkillInput {
  sessionId: string;
  ownerUserId: string;
  resourceRef: string;
  skillId: string;
  sourceId: string;
  version: string | null;
  manifest: unknown;
  contentDigest: string;
  enabled?: boolean;
  pinned?: boolean;
  expectedRevision: number;
}

/**
 * 安装 / 覆盖一条会话级技能。
 *
 * 事务内先做 revision CAS 再写条目：`expectedRevision` 不匹配时整体回滚，条目
 * 与 revision 不会出现「条目录了、revision 没动」的半成品状态。
 */
export function upsertSessionSkill(
  input: UpsertSessionSkillInput,
): SessionExtensionSettings | undefined {
  return sqliteTransaction(() => {
    const current = getSessionExtensionSettings(input.sessionId);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) return undefined;

    const now = Date.now();
    const nextRevision = bumpRevisionInTransaction(input.sessionId, input.ownerUserId, now);
    sqliteRun(
      `INSERT INTO session_skill_installations
         (resource_ref, session_id, user_id, skill_id, source_id, version, manifest_json,
          content_digest, enabled, pinned, revision, installed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, resource_ref) DO UPDATE SET
         skill_id = excluded.skill_id,
         source_id = excluded.source_id,
         version = excluded.version,
         manifest_json = excluded.manifest_json,
         content_digest = excluded.content_digest,
         enabled = excluded.enabled,
         pinned = excluded.pinned,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
      [
        input.resourceRef,
        input.sessionId,
        input.ownerUserId,
        input.skillId,
        input.sourceId,
        input.version,
        JSON.stringify(input.manifest ?? null),
        input.contentDigest,
        (input.enabled ?? true) ? 1 : 0,
        (input.pinned ?? false) ? 1 : 0,
        nextRevision,
        now,
        now,
      ],
    );
    return getSessionExtensionSettings(input.sessionId);
  });
}

export function removeSessionSkill(params: {
  sessionId: string;
  ownerUserId: string;
  resourceRef: string;
  expectedRevision: number;
}): SessionExtensionSettings | undefined {
  return sqliteTransaction(() => {
    const current = getSessionExtensionSettings(params.sessionId);
    if ((current?.revision ?? 0) !== params.expectedRevision) return undefined;
    const existing = getSessionSkill(params.sessionId, params.resourceRef);
    if (!existing) return undefined;

    const now = Date.now();
    sqliteRun('DELETE FROM session_skill_installations WHERE session_id = ? AND resource_ref = ?', [
      params.sessionId,
      params.resourceRef,
    ]);
    bumpRevisionInTransaction(params.sessionId, params.ownerUserId, now);
    return getSessionExtensionSettings(params.sessionId);
  });
}

/**
 * 启停 / 固定会话技能。
 *
 * 禁用与撤权是**立即生效的拒绝屏障**（不是下一轮）：解析器始终重新读库，
 * 运行中的调用在下次校验时会看到 `enabled = 0`。
 */
export function setSessionSkillFlags(params: {
  sessionId: string;
  ownerUserId: string;
  resourceRef: string;
  enabled?: boolean;
  pinned?: boolean;
  expectedRevision: number;
}): SessionExtensionSettings | undefined {
  return sqliteTransaction(() => {
    const current = getSessionExtensionSettings(params.sessionId);
    if ((current?.revision ?? 0) !== params.expectedRevision) return undefined;
    const existing = getSessionSkill(params.sessionId, params.resourceRef);
    if (!existing) return undefined;

    const now = Date.now();
    const nextRevision = bumpRevisionInTransaction(params.sessionId, params.ownerUserId, now);
    sqliteRun(
      `UPDATE session_skill_installations
          SET enabled = ?, pinned = ?, revision = ?, updated_at = ?
        WHERE session_id = ? AND resource_ref = ?`,
      [
        (params.enabled ?? existing.enabled) ? 1 : 0,
        (params.pinned ?? existing.pinned) ? 1 : 0,
        nextRevision,
        now,
        params.sessionId,
        params.resourceRef,
      ],
    );
    return getSessionExtensionSettings(params.sessionId);
  });
}

// ---------------------------------------------------------------------------
// 会话 MCP
// ---------------------------------------------------------------------------

interface SessionMcpRow {
  resource_ref: string;
  display_id: string;
  config_json: string;
  secret_ref: string | null;
  enabled: number;
  disabled_tools_json: string;
  revision: number;
}

function rowToSessionMcp(row: SessionMcpRow): SessionMcpServerRecord {
  const parsedTools = safeParseJson(row.disabled_tools_json);
  return {
    resourceRef: row.resource_ref,
    displayId: row.display_id,
    config: safeParseJson(row.config_json),
    secretRef: row.secret_ref,
    enabled: row.enabled === 1,
    disabledTools: Array.isArray(parsedTools)
      ? parsedTools.filter((entry): entry is string => typeof entry === 'string')
      : [],
    revision: row.revision,
  };
}

export function listSessionMcpServers(sessionId: string): SessionMcpServerRecord[] {
  const rows = sqliteAll<SessionMcpRow>(
    'SELECT * FROM session_mcp_servers WHERE session_id = ? ORDER BY updated_at DESC',
    [sessionId],
  );
  return rows.map(rowToSessionMcp);
}

export function getSessionMcpServer(
  sessionId: string,
  resourceRef: string,
): SessionMcpServerRecord | undefined {
  const row = sqliteGet<SessionMcpRow>(
    'SELECT * FROM session_mcp_servers WHERE session_id = ? AND resource_ref = ? LIMIT 1',
    [sessionId, resourceRef],
  );
  return row ? rowToSessionMcp(row) : undefined;
}

export interface UpsertSessionMcpInput {
  sessionId: string;
  ownerUserId: string;
  resourceRef: string;
  displayId: string;
  config: unknown;
  secretRef?: string | null;
  enabled?: boolean;
  disabledTools?: readonly string[];
  expectedRevision: number;
}

export function upsertSessionMcpServer(
  input: UpsertSessionMcpInput,
): SessionExtensionSettings | undefined {
  return sqliteTransaction(() => {
    const current = getSessionExtensionSettings(input.sessionId);
    if ((current?.revision ?? 0) !== input.expectedRevision) return undefined;

    const now = Date.now();
    const nextRevision = bumpRevisionInTransaction(input.sessionId, input.ownerUserId, now);
    const existing = getSessionMcpServer(input.sessionId, input.resourceRef);
    sqliteRun(
      `INSERT INTO session_mcp_servers
         (resource_ref, session_id, user_id, display_id, config_json, secret_ref, enabled,
          disabled_tools_json, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, resource_ref) DO UPDATE SET
         display_id = excluded.display_id,
         config_json = excluded.config_json,
         secret_ref = excluded.secret_ref,
         enabled = excluded.enabled,
         disabled_tools_json = excluded.disabled_tools_json,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
      [
        input.resourceRef,
        input.sessionId,
        input.ownerUserId,
        input.displayId,
        JSON.stringify(input.config ?? null),
        input.secretRef ?? null,
        (input.enabled ?? true) ? 1 : 0,
        JSON.stringify(input.disabledTools ?? existing?.disabledTools ?? []),
        nextRevision,
        now,
        now,
      ],
    );
    return getSessionExtensionSettings(input.sessionId);
  });
}

export function removeSessionMcpServer(params: {
  sessionId: string;
  ownerUserId: string;
  resourceRef: string;
  expectedRevision: number;
}): SessionExtensionSettings | undefined {
  return sqliteTransaction(() => {
    const current = getSessionExtensionSettings(params.sessionId);
    if ((current?.revision ?? 0) !== params.expectedRevision) return undefined;
    const existing = getSessionMcpServer(params.sessionId, params.resourceRef);
    if (!existing) return undefined;

    const now = Date.now();
    sqliteRun('DELETE FROM session_mcp_servers WHERE session_id = ? AND resource_ref = ?', [
      params.sessionId,
      params.resourceRef,
    ]);
    bumpRevisionInTransaction(params.sessionId, params.ownerUserId, now);
    return getSessionExtensionSettings(params.sessionId);
  });
}

export function setSessionMcpEnabled(params: {
  sessionId: string;
  ownerUserId: string;
  resourceRef: string;
  enabled: boolean;
  expectedRevision: number;
}): SessionExtensionSettings | undefined {
  return sqliteTransaction(() => {
    const current = getSessionExtensionSettings(params.sessionId);
    if ((current?.revision ?? 0) !== params.expectedRevision) return undefined;
    const existing = getSessionMcpServer(params.sessionId, params.resourceRef);
    if (!existing) return undefined;

    const now = Date.now();
    const nextRevision = bumpRevisionInTransaction(params.sessionId, params.ownerUserId, now);
    sqliteRun(
      `UPDATE session_mcp_servers SET enabled = ?, revision = ?, updated_at = ?
        WHERE session_id = ? AND resource_ref = ?`,
      [params.enabled ? 1 : 0, nextRevision, now, params.sessionId, params.resourceRef],
    );
    return getSessionExtensionSettings(params.sessionId);
  });
}

// ---------------------------------------------------------------------------
// 审批人清单
// ---------------------------------------------------------------------------

interface AdminRow {
  user_id: string;
  admin_user_id: string;
  created_at: number;
}

/**
 * 审批人必须是 owner 的独立管理员清单成员。
 *
 * owner 自己**隐式**是管理员（否则会出现「谁也批不了」的死锁）；这仍然是
 * 「管理员 ∧ owner」的合取，因为 owner 必然满足第一个条件。
 */
export function isSessionExtensionApprover(ownerUserId: string, approverUserId: string): boolean {
  if (ownerUserId === approverUserId) return true;
  const row = sqliteGet<Pick<AdminRow, 'admin_user_id'>>(
    'SELECT admin_user_id FROM session_extension_admins WHERE user_id = ? AND admin_user_id = ? LIMIT 1',
    [ownerUserId, approverUserId],
  );
  return Boolean(row);
}

export function listSessionExtensionAdmins(ownerUserId: string): string[] {
  const rows = sqliteAll<Pick<AdminRow, 'admin_user_id'>>(
    'SELECT admin_user_id FROM session_extension_admins WHERE user_id = ? ORDER BY created_at ASC',
    [ownerUserId],
  );
  return rows.map((row) => row.admin_user_id);
}

export function addSessionExtensionAdmin(ownerUserId: string, adminUserId: string): void {
  sqliteRun(
    `INSERT INTO session_extension_admins (user_id, admin_user_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, admin_user_id) DO NOTHING`,
    [ownerUserId, adminUserId, Date.now()],
  );
}

export function removeSessionExtensionAdmin(ownerUserId: string, adminUserId: string): boolean {
  const existing = sqliteGet<Pick<AdminRow, 'admin_user_id'>>(
    'SELECT admin_user_id FROM session_extension_admins WHERE user_id = ? AND admin_user_id = ? LIMIT 1',
    [ownerUserId, adminUserId],
  );
  if (!existing) return false;
  sqliteRun('DELETE FROM session_extension_admins WHERE user_id = ? AND admin_user_id = ?', [
    ownerUserId,
    adminUserId,
  ]);
  return true;
}

// ---------------------------------------------------------------------------
// 清理
// ---------------------------------------------------------------------------

/**
 * 删除会话的全部扩展数据（含操作记录）。
 *
 * 主要给「删除会话」的恢复语句兜底：主路径已由 FK `ON DELETE CASCADE` 覆盖，
 * 这里额外提供显式清理入口，供不回退 FK 的场景与测试使用。
 */
