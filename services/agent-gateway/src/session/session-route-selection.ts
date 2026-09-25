/**
 * 会话路由选择（模型 / 思考档位）的持久化与唤醒回退。
 *
 * 背景：普通 chat 会话的模型与思考档位此前**只由客户端每轮随请求携带**，
 * 网关不回写、解析时也不回退会话 metadata。这会带来一个自动的前缀抖动：
 *
 *   - `continueSessionFromHistory`（子代理完成唤醒父会话 / 任务自动续跑）
 *     构造的是空 requestData（不含 model / thinkingEnabled / reasoningEffort）；
 *   - 非 team 会话的思考解析只读 `requestData`，于是唤醒轮退化为「未启用思考」；
 *   - 而 stable system 段里的 `thinkingLanguagePrompt` 槽位在「启用/未启用」
 *     之间切换占位符与指令 → **整段历史 prompt-cache 前缀在每次唤醒时被打断**，
 *     下一轮再翻回来（又一次打断）。
 *
 * 修复：把主对话流的解析结果按会话持久化（`sessions.metadata_json` 的
 * `modelId` / `providerId` / `thinkingEnabled` / `reasoningEffort`，与客户端
 * PATCH 和 `parseSessionProviderSelection` 使用同一组键），并在请求未携带
 * thinking 字段时回退到会话 metadata——唤醒轮与正常轮的前缀由此保持一致。
 */

import { sqliteGet, sqliteRun } from '../infra/db.js';

export interface PersistableSessionRouteSelection {
  modelId?: string;
  providerId?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: string;
}

interface SessionMetadataRow {
  metadata_json: string;
}

function readMetadata(sessionId: string, userId: string): Record<string, unknown> | null {
  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );
  if (!row?.metadata_json) return null;
  try {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 把本轮解析出的路由选择合并进会话 metadata。
 *
 * - 未提供的字段不下发、也不清除既有值（唤醒轮只读不写）；
 * - 值未变化时跳过写入（避免每轮无谓的 metadata 写入）。
 *
 * 返回是否实际写库。
 */
export function persistSessionRouteSelection(
  sessionId: string,
  userId: string,
  selection: PersistableSessionRouteSelection,
): boolean {
  const metadata = readMetadata(sessionId, userId);
  if (metadata === null) return false;

  let changed = false;
  const assign = <K extends keyof PersistableSessionRouteSelection>(
    key: K,
    value: PersistableSessionRouteSelection[K],
  ): void => {
    if (value === undefined) return;
    if (metadata[key] === value) return;
    metadata[key] = value;
    changed = true;
  };
  assign('modelId', selection.modelId);
  assign('providerId', selection.providerId);
  assign('thinkingEnabled', selection.thinkingEnabled);
  assign('reasoningEffort', selection.reasoningEffort);

  if (!changed) return false;
  sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?', [
    JSON.stringify(metadata),
    sessionId,
    userId,
  ]);
  return true;
}

export interface EffectiveThinkingSelection {
  thinkingEnabled?: boolean;
  reasoningEffort?: string;
}

/**
 * 解析本轮生效的思考档位（纯函数）。
 *
 * 优先级：
 *   1. team 权威绑定（模板写进 metadata 的档位）——保持既有语义：覆盖请求；
 *   2. 请求显式携带的值；
 *   3. 会话 metadata 回退（唤醒轮没有请求值时，与正常轮保持一致）。
 */
export function resolveEffectiveThinkingSelection(input: {
  requestDataThinkingEnabled?: boolean;
  requestDataReasoningEffort?: string;
  sessionThinkingEnabled?: boolean;
  sessionReasoningEffort?: string;
  hasAuthoritativeTeamModel: boolean;
}): EffectiveThinkingSelection {
  const thinkingEnabled = (() => {
    if (input.hasAuthoritativeTeamModel && input.sessionThinkingEnabled !== undefined) {
      return input.sessionThinkingEnabled;
    }
    if (input.requestDataThinkingEnabled !== undefined) return input.requestDataThinkingEnabled;
    return input.sessionThinkingEnabled;
  })();
  const reasoningEffort = (() => {
    if (input.hasAuthoritativeTeamModel && input.sessionReasoningEffort) {
      return input.sessionReasoningEffort;
    }
    if (input.requestDataReasoningEffort !== undefined) return input.requestDataReasoningEffort;
    return input.sessionReasoningEffort;
  })();

  return {
    ...(thinkingEnabled !== undefined ? { thinkingEnabled } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  };
}
