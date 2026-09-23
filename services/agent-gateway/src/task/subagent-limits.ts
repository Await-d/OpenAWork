import { sqliteAll, sqliteGet } from '../infra/db.js';
import { parseStoredSubagentLimits, type SubagentLimits } from '../provider/provider-config.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';

/**
 * 子代理数量限制（用户级）的读取、归一与派发判定。
 *
 * 存储形态：`user_settings` 的 `subagent_limits` 键（JSON 对象），由设置页
 * `PUT /settings/providers` 写入。**读取发生在每次派发时**，因此设置保存后
 * 立即生效，无需重启网关、也不影响已在运行的子代理。
 *
 * 历史键 `subagent_depth`（仅深度，数字或数字字符串）作为 `maxNestingDepth`
 * 的回落来源保留：升级前设置过深度的用户不会被静默重置为默认值。
 *
 * 判定口径：以**任务树根**为单位统计（`metadata.parentSessionId` 链的最早祖先），
 * 只统计 task 工具创建的子会话（`metadata.createdByTool === 'task'`）——
 * team 后台成员 / handoff 子会话不受本限制约束。
 */

const SUBAGENT_LIMITS_KEY = 'subagent_limits';
const LEGACY_SUBAGENT_DEPTH_KEY = 'subagent_depth';

interface TaskSessionRow {
  id: string;
  metadata_json: string;
  state_status: string;
}

interface ParsedTaskSessionRow extends TaskSessionRow {
  metadata: Record<string, unknown>;
  parentSessionId: string | null;
}

function parseStoredValue(value: string | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    // 历史写入可能是裸数字字符串（如 `3` 而非 `"3"`），原样交给归一函数。
    return value;
  }
}

function readUserSettingValue(userId: string, key: string): string | undefined {
  const row = sqliteGet<{ value: string }>(
    'SELECT value FROM user_settings WHERE user_id = ? AND key = ?',
    [userId, key],
  );
  return row?.value;
}

/** 读取并归一当前用户的子代理数量限制（缺省回落默认值）。 */
export function resolveSubagentLimitsForUser(userId: string): SubagentLimits {
  const rawLimits = parseStoredValue(readUserSettingValue(userId, SUBAGENT_LIMITS_KEY));
  const legacyDepth = parseStoredValue(readUserSettingValue(userId, LEGACY_SUBAGENT_DEPTH_KEY));

  return parseStoredSubagentLimits(rawLimits, {
    fallbackNestingDepth: legacyDepth,
  });
}

/** 是否为 task 工具创建的子会话（数量限制只统计这类会话）。 */
export function isTaskCreatedSessionMetadata(metadata: Record<string, unknown>): boolean {
  return metadata.createdByTool === 'task';
}

function listParsedTaskSessionsForUser(userId: string): ParsedTaskSessionRow[] {
  return sqliteAll<TaskSessionRow>(
    'SELECT id, metadata_json, state_status FROM sessions WHERE user_id = ?',
    [userId],
  ).map((row) => {
    const metadata = parseSessionMetadataJson(row.metadata_json);
    const parentSessionId =
      typeof metadata.parentSessionId === 'string' ? metadata.parentSessionId : null;
    return {
      ...row,
      metadata,
      parentSessionId,
    };
  });
}

/** 沿 `parentSessionId` 链上溯（含自身）；断链或成环时在当前位置停止。 */
function resolveTaskSessionChain(
  sessionsById: ReadonlyMap<string, ParsedTaskSessionRow>,
  sessionId: string,
): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentSessionId: string | null = sessionId;

  while (currentSessionId && !visited.has(currentSessionId)) {
    chain.push(currentSessionId);
    visited.add(currentSessionId);
    currentSessionId = sessionsById.get(currentSessionId)?.parentSessionId ?? null;
  }

  return chain;
}

function resolveTaskRootSessionId(
  sessionsById: ReadonlyMap<string, ParsedTaskSessionRow>,
  sessionId: string,
): string {
  const chain = resolveTaskSessionChain(sessionsById, sessionId);
  return chain[chain.length - 1] ?? sessionId;
}

function countTaskChildSessionsUnderRoot(
  sessionsById: ReadonlyMap<string, ParsedTaskSessionRow>,
  rootSessionId: string,
): number {
  let count = 0;
  for (const session of sessionsById.values()) {
    if (!isTaskCreatedSessionMetadata(session.metadata)) {
      continue;
    }

    if (resolveTaskRootSessionId(sessionsById, session.id) === rootSessionId) {
      count += 1;
    }
  }

  return count;
}

function countRunningTaskChildSessionsUnderRoot(
  sessionsById: ReadonlyMap<string, ParsedTaskSessionRow>,
  rootSessionId: string,
  excludeSessionId?: string,
): number {
  let count = 0;
  for (const session of sessionsById.values()) {
    if (session.id === excludeSessionId || session.state_status !== 'running') {
      continue;
    }

    if (!isTaskCreatedSessionMetadata(session.metadata)) {
      continue;
    }

    if (resolveTaskRootSessionId(sessionsById, session.id) === rootSessionId) {
      count += 1;
    }
  }

  return count;
}

/**
 * 子代理派发的数量上限校验（用户级可调，见设置页「子代理」区域）：
 * - `maxTotalPerRoot`：同一任务树累计创建的 task 子会话数；
 * - `maxRunningPerRoot`：同一任务树中同时 running 的 task 子会话数。
 *
 * 限制值每次派发时从 `user_settings.subagent_limits` 读取 ⇒ 设置保存后立即生效。
 * 嵌套深度不在本函数：由 `checkSubagentDepthAllowed`（`subagent_limits.maxNestingDepth`）
 * 统一承担，避免两条口径互相叠加。
 */
export function getTaskSessionLimitError(input: {
  currentSessionId: string;
  excludeRunningSessionId?: string;
  isNewChildSession: boolean;
  userId: string;
}): string | null {
  const limits = resolveSubagentLimitsForUser(input.userId);
  const taskSessions = listParsedTaskSessionsForUser(input.userId);
  const sessionsById = new Map(taskSessions.map((session) => [session.id, session]));
  const rootSessionId = resolveTaskRootSessionId(sessionsById, input.currentSessionId);

  if (
    input.isNewChildSession &&
    countTaskChildSessionsUnderRoot(sessionsById, rootSessionId) >= limits.maxTotalPerRoot
  ) {
    return `当前任务树下的子代理数量已达到上限（${limits.maxTotalPerRoot}），请先结束部分子任务再继续委派。`;
  }

  if (
    countRunningTaskChildSessionsUnderRoot(
      sessionsById,
      rootSessionId,
      input.excludeRunningSessionId,
    ) >= limits.maxRunningPerRoot
  ) {
    return `当前任务树中正在运行的子代理已达到上限（${limits.maxRunningPerRoot}），请等待已有子任务完成后再继续。`;
  }

  return null;
}
