import { sqliteGet } from '../infra/db.js';
import {
  parseStoredSubagentModelPolicy,
  type SubagentModelPolicy,
} from '../provider/provider-config.js';

interface UserSettingRow {
  value: string;
}

/** 读取用户级「子代理模型来源」策略，缺失/损坏时回落 auto。 */
export function resolveSubagentModelPolicyForUser(userId: string): SubagentModelPolicy {
  let raw: unknown;
  try {
    const row = sqliteGet<UserSettingRow>(
      `SELECT value FROM user_settings WHERE user_id = ? AND key = 'subagent_model_policy'`,
      [userId],
    );
    raw = row ? (JSON.parse(row.value) as unknown) : undefined;
  } catch {
    raw = undefined;
  }
  return parseStoredSubagentModelPolicy(raw);
}

export interface InheritedParentModelSelection {
  modelId: string;
  providerId?: string;
  variant?: string;
}

export interface InheritedParentModelOwner {
  providerId?: string;
  variant?: string;
}

/**
 * 解析「主对话当前模型」：优先本轮请求 requestData（UI 每轮下发），
 * 回退父会话 metadata。`default`/空值视为未指定。无模型时返回 undefined。
 */
export function resolveInheritedParentModel(input: {
  requestData?: Record<string, unknown>;
  parentSessionMetadata: Record<string, unknown>;
}): InheritedParentModelSelection | undefined {
  const requestData = input.requestData ?? {};
  const metadata = input.parentSessionMetadata;
  const readString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim().length > 0 && value.trim() !== 'default'
      ? value.trim()
      : undefined;
  const modelId = readString(requestData['model']) ?? readString(metadata['modelId']);
  if (!modelId) return undefined;
  const providerId = readString(requestData['providerId']) ?? readString(metadata['providerId']);
  const variant = readString(requestData['variant']) ?? readString(metadata['variant']);
  return {
    modelId,
    ...(providerId ? { providerId } : {}),
    ...(variant ? { variant } : {}),
  };
}

/**
 * 补齐 inherit-main 继承模型的归属信息：父轮请求可能只带 `model`（无 `providerId`），
 * 此时子会话流式解析会因缺少显式 provider 选择而回落到聊天默认模型。
 * 由调用方注入解析器反查模型归属：仅在缺少 `providerId` 时补写，
 * 继承选择已有 `variant` 时不覆盖；解析不到归属时原样返回。
 */
export function completeInheritedParentModel(
  selection: InheritedParentModelSelection,
  resolveOwner: (modelId: string) => InheritedParentModelOwner | undefined,
): InheritedParentModelSelection {
  if (selection.providerId) {
    return selection;
  }
  const owner = resolveOwner(selection.modelId);
  if (!owner?.providerId) {
    return selection;
  }
  const variant = selection.variant ?? owner.variant;
  return {
    modelId: selection.modelId,
    providerId: owner.providerId,
    ...(variant ? { variant } : {}),
  };
}
