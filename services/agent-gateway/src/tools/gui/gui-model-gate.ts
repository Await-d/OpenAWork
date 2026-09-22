/**
 * T-14c：GUI 模型门控。
 *
 * 判定「**当前会话实际使用的模型**是否具备 GUI grounding 能力」：
 *  - 路径 A（Gate 0 决策 1，已定）：复用现有 Provider，用 provider 类的
 *    `supportsGuiGrounding(modelId)` 判定；
 *  - 路径 B：若当前模型不具备 grounding，但运维配置了自定义 GUI endpoint
 *    （`OPENAWORK_GUI_ENDPOINT_URL` + `OPENAWORK_GUI_ENDPOINT_MODEL`），则放行并
 *    指向该 endpoint。
 *
 * **模型来源优先级（与主对话保持一致，这是关键）**：
 *   1. 会话 metadata 的 `providerId` / `modelId`（会话内手动切过模型时写入，
 *      前端每轮也会显式带上 → 主对话实际用的就是它）
 *   2. 用户级 `active_selection`（会话未指定模型时的全局默认）
 *
 * 若只读 `active_selection`，会出现「会话固定用支持 grounding 的模型、但全局默认
 * 不支持 → GUI 被错误拒绝」的不一致，因此必须优先采用会话级选择。
 *
 * 设计原则：**无可用模型时明确报错**，绝不静默降级到不具备 grounding 的模型。
 */
import type { ProviderType } from '@openAwork/agent-core';
import { AnthropicProvider, OpenAIProvider } from '@openAwork/opencode-llm';
import { sqliteGet } from '../../infra/db.js';
import { getProviderConfigForSelection } from '../../provider/provider-config.js';

export interface GuiModelGateResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly route?: { readonly providerId: string; readonly modelId: string };
}

interface UserSettingRow {
  readonly value: string | null;
}

interface SessionRow {
  readonly metadata_json: string | null;
}

/** 路径 B：自定义 GUI endpoint 的显式开关（运维配置，非用户级设置）。 */
const GUI_ENDPOINT_URL_ENV = 'OPENAWORK_GUI_ENDPOINT_URL';
const GUI_ENDPOINT_MODEL_ENV = 'OPENAWORK_GUI_ENDPOINT_MODEL';
/** 路径 B 使用的合成 providerId，标识「非当前选中 Provider」。 */
const GUI_ENDPOINT_PROVIDER_ID = 'gui-endpoint';

const GUI_GROUNDING_HINT =
  '请改用支持 GUI grounding 的模型（如 OpenAI computer-use-preview 或 Claude computer-use 系列）';

/**
 * 判定当前会话（或用户默认）使用的模型是否具备 GUI grounding 能力。
 *
 * @param userId    会话所属用户
 * @param sessionId 当前会话 id；提供后会优先采用该会话 metadata 里的模型选择，
 *                  保证 GUI 与主对话用的是**同一个模型**。
 */
export async function resolveGuiModelGate(
  userId: string,
  sessionId?: string,
): Promise<GuiModelGateResult> {
  const providersRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );

  const sessionSelection = sessionId ? readSessionModelSelection(userId, sessionId) : null;
  const providerConfig = await getProviderConfigForSelection(
    providersRow?.value ? parseStoredJson(providersRow.value) : undefined,
    selectionRow?.value ? parseStoredJson(selectionRow.value) : undefined,
    // 会话级选择优先；未指定时保持原行为（回退 active_selection）。
    sessionSelection ?? undefined,
  );

  if (!providerConfig) {
    return {
      allowed: false,
      reason: `未找到可用的模型配置，无法执行 GUI 操作。${GUI_GROUNDING_HINT}。`,
    };
  }

  const { provider, modelId } = providerConfig;
  if (providerSupportsGuiGrounding(provider.type, modelId)) {
    return {
      allowed: true,
      route: { providerId: provider.id, modelId },
    };
  }

  // 路径 B：当前模型不具备 grounding，但配置了自定义 GUI endpoint 时放行。
  const endpoint = readGuiEndpointConfig();
  if (endpoint) {
    return {
      allowed: true,
      reason: `当前模型「${provider.name}/${modelId}」不具备 GUI grounding 能力，已改用自定义 GUI endpoint（${endpoint.modelId}）。`,
      route: { providerId: GUI_ENDPOINT_PROVIDER_ID, modelId: endpoint.modelId },
    };
  }

  return {
    allowed: false,
    reason: `当前模型「${provider.name}/${modelId}」不具备 GUI grounding 能力，无法输出可执行的屏幕坐标。${GUI_GROUNDING_HINT}，或配置自定义 GUI endpoint（${GUI_ENDPOINT_URL_ENV} + ${GUI_ENDPOINT_MODEL_ENV}）。`,
  };
}

/**
 * 读取会话 metadata 里记录的模型选择。
 *
 * 前端在会话内手动切换模型时会写入 `providerId` / `modelId`（`modelSelectionSource`
 * 标记来源），主对话每轮也会显式带上这两个值——所以这里读到的就是主对话实际用的模型。
 * 任一字段缺失即视为「会话未指定模型」，由调用方回退到 `active_selection`。
 */
function readSessionModelSelection(
  userId: string,
  sessionId: string,
): { readonly providerId: string; readonly modelId: string } | null {
  const row = sqliteGet<SessionRow>(
    `SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?`,
    [sessionId, userId],
  );
  if (!row?.metadata_json) {
    return null;
  }

  const parsed = parseStoredJson(row.metadata_json);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const providerId = record['providerId'];
  const modelId = record['modelId'];
  if (
    typeof providerId !== 'string' ||
    providerId.trim().length === 0 ||
    typeof modelId !== 'string' ||
    modelId.trim().length === 0
  ) {
    return null;
  }

  return { providerId: providerId.trim(), modelId: modelId.trim() };
}

function providerSupportsGuiGrounding(providerType: ProviderType, modelId: string): boolean {
  switch (providerType) {
    case 'openai':
      return new OpenAIProvider().supportsGuiGrounding(modelId);
    case 'anthropic':
      return new AnthropicProvider().supportsGuiGrounding(modelId);
    default:
      return false;
  }
}

function readGuiEndpointConfig(): { readonly url: string; readonly modelId: string } | null {
  const url = readEnv(GUI_ENDPOINT_URL_ENV);
  const modelId = readEnv(GUI_ENDPOINT_MODEL_ENV);
  if (!url || !modelId) {
    return null;
  }
  return { url, modelId };
}

function readEnv(name: string): string | null {
  const value = globalThis.process?.env[name];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // 存储内容损坏时按「未配置」处理，交由上层给出明确的中文错误。
    return undefined;
  }
}
