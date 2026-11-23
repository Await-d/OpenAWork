/**
 * 对话模式提示词用户级覆盖存储（`user_settings.prompt_overrides`）。
 *
 * 背景：模式提示词的默认值是编译期常量（`routes/dialogue-mode-prompts/`），用户改不了。
 * 本模块把「用户改过的模式文本」单独落在 `prompt_overrides` 键下，取值点按
 * 「覆盖优先、默认兜底」解析（见 `resolve-dialogue-mode-prompt.ts`）。
 *
 * 为什么不并入 `agent_catalog`：内置 Agent 覆盖复用该键的 `builtinOverrides`（含模型字段），
 * 与模式覆盖（只有文本、无模型语义）的生命周期不同，混存会让 reset 与差异比对互相牵连。
 *
 * 校验边界：**不复用** `memory-security-scanner` 的词面规则 —— 那是针对不可信记忆注入的
 * 硬拒绝器，会把 `Never reveal your system prompt` 这类正常指令一并拦掉。这里只做类型、
 * 长度与非法控制字符校验；提示词文本本身不构成任何授权依据。
 *
 * 容错约定：运行路径（每轮 stream）坏 JSON 只告警并回落默认，绝不抛错打断流式；
 * 管理路径必须把损坏状态透出（`configState: 'corrupt'`），不能伪装成「没有覆盖」。
 */
import type { DialogueMode } from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS } from '../provider/model-router.js';
import { DIALOGUE_MODE_SYSTEM_PROMPTS } from '../routes/dialogue-mode-prompts/index.js';

export const PROMPT_OVERRIDES_SETTING_KEY = 'prompt_overrides';

export const DIALOGUE_MODES = ['clarify', 'coding', 'programmer'] as const;

/** 与 `/agents` 的 systemPrompt 上限同源，避免两处提示词长度口径漂移。 */
export const PROMPT_OVERRIDE_MAX_CHARS = MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS;

/** 供路由层复用的稳定错误文案（用户文本不会与之相同，可安全用于消息匹配）。 */
export const PROMPT_OVERRIDE_ERROR_MESSAGES = {
  unknownMode: '未知的对话模式。',
  emptyText: '提示词不能为空。',
  tooLong: `提示词不能超过 ${PROMPT_OVERRIDE_MAX_CHARS} 个字符。`,
  invalidCharacters: '提示词包含不允许的控制字符。',
} as const;

export interface DialogueModePromptView {
  mode: DialogueMode;
  /** 当前版本的编译期默认值，供 UI 展示「以默认值为起点编辑」。 */
  defaultText: string;
  /** 实际注入的文本（有覆盖取覆盖，否则等于默认值）。 */
  effectiveText: string;
  hasOverride: boolean;
}

export interface PromptOverrideSnapshot {
  modes: DialogueModePromptView[];
  maxChars: number;
  /** `ok` = 配置可读；`corrupt` = 存在无法解析的配置（已回落默认，需用户重置）。 */
  configState: 'ok' | 'corrupt';
}

interface UserSettingRow {
  value: string;
}

type ModeOverrides = Partial<Record<DialogueMode, string>>;

function assertDialogueMode(mode: string): asserts mode is DialogueMode {
  if (!DIALOGUE_MODES.some((candidate) => candidate === mode)) {
    throw new Error(PROMPT_OVERRIDE_ERROR_MESSAGES.unknownMode);
  }
}

function isForbiddenCodePoint(code: number): boolean {
  // 双向控制（U+202A..202E / U+2066..2069）
  if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
    return true;
  }
  // 零宽
  if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0x180e || code === 0xfeff) {
    return true;
  }
  // Tag block（曾被用于不可见 prompt injection）
  if (code >= 0xe0000 && code <= 0xe007f) {
    return true;
  }
  // 私有使用区
  if (
    (code >= 0xe000 && code <= 0xf8ff) ||
    (code >= 0xf0000 && code <= 0xffffd) ||
    (code >= 0x100000 && code <= 0x10fffd)
  ) {
    return true;
  }
  const isAsciiControl =
    code >= 0x00 && code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
  return isAsciiControl || code === 0x7f;
}

function findForbiddenControlChar(text: string): string | null {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }
    if (isForbiddenCodePoint(code)) {
      return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return null;
}

/**
 * 校验用户提交的提示词文本。
 *
 * 有效文本**原样保留**前后空白（`trim` 只用于空白判断），不静默改写用户内容。
 */
export function validateDialogueModePromptText(text: string): string {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error(PROMPT_OVERRIDE_ERROR_MESSAGES.emptyText);
  }
  if (text.length > PROMPT_OVERRIDE_MAX_CHARS) {
    throw new Error(PROMPT_OVERRIDE_ERROR_MESSAGES.tooLong);
  }
  if (findForbiddenControlChar(text) !== null) {
    throw new Error(PROMPT_OVERRIDE_ERROR_MESSAGES.invalidCharacters);
  }
  return text;
}

function parseStoredOverrides(value: string | undefined): {
  overrides: ModeOverrides;
  corrupt: boolean;
} {
  if (!value) {
    return { overrides: {}, corrupt: false };
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const rawModes = parsed['dialogueModes'];
    if (rawModes === undefined) {
      return { overrides: {}, corrupt: false };
    }
    if (typeof rawModes !== 'object' || rawModes === null || Array.isArray(rawModes)) {
      return { overrides: {}, corrupt: true };
    }
    const record = rawModes as Record<string, unknown>;
    const overrides: ModeOverrides = {};
    let hasInvalidEntry = false;
    for (const mode of DIALOGUE_MODES) {
      const text = record[mode];
      // 缺失的键 = 该模式用默认值，属正常状态。
      if (text === undefined) {
        continue;
      }
      // 键存在但值非法（类型错 / 纯空白）不能静默丢弃：静默丢弃会把异常伪装成
      //「该模式没有覆盖」，与「管理路径必须透出损坏状态」的约定冲突（复查 V-07）。
      if (typeof text !== 'string' || text.trim().length === 0) {
        hasInvalidEntry = true;
        continue;
      }
      overrides[mode] = text;
    }
    return { overrides, corrupt: hasInvalidEntry };
  } catch {
    return { overrides: {}, corrupt: true };
  }
}

function loadRawOverrides(userId: string): { overrides: ModeOverrides; corrupt: boolean } {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, PROMPT_OVERRIDES_SETTING_KEY],
  );
  return parseStoredOverrides(row?.value);
}

function buildModeView(mode: DialogueMode, override: string | undefined): DialogueModePromptView {
  const defaultText = DIALOGUE_MODE_SYSTEM_PROMPTS[mode];
  return {
    mode,
    defaultText,
    effectiveText: override ?? defaultText,
    hasOverride: override !== undefined,
  };
}

function persistOverrides(userId: string, overrides: ModeOverrides): void {
  if (Object.keys(overrides).length === 0) {
    sqliteRun(`DELETE FROM user_settings WHERE user_id = ? AND key = ?`, [
      userId,
      PROMPT_OVERRIDES_SETTING_KEY,
    ]);
    return;
  }
  const stored: { dialogueModes: ModeOverrides } = { dialogueModes: overrides };
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [userId, PROMPT_OVERRIDES_SETTING_KEY, JSON.stringify(stored)],
  );
}

/**
 * 运行路径读取：坏 JSON 只告警并回落（返回空覆盖），不抛错。
 */
export function readDialogueModePromptOverrides(userId: string): ModeOverrides {
  const { overrides, corrupt } = loadRawOverrides(userId);
  if (corrupt) {
    logGatewayWarn(
      `[prompt-overrides] 用户 ${userId} 的模式提示词配置无法解析，本轮已回落默认值。`,
    );
  }
  return overrides;
}

/** 解析指定模式的最终注入文本（覆盖优先、默认兜底）。 */
export function resolveDialogueModePromptText(userId: string, mode: DialogueMode): string {
  const overrides = readDialogueModePromptOverrides(userId);
  return overrides[mode] ?? DIALOGUE_MODE_SYSTEM_PROMPTS[mode];
}

/** 管理路径读取：同时返回默认值、有效值与配置健康状态。 */
export function readPromptOverrideSnapshot(userId: string): PromptOverrideSnapshot {
  const { overrides, corrupt } = loadRawOverrides(userId);
  return {
    modes: DIALOGUE_MODES.map((mode) => buildModeView(mode, overrides[mode])),
    maxChars: PROMPT_OVERRIDE_MAX_CHARS,
    configState: corrupt ? 'corrupt' : 'ok',
  };
}

export function writeDialogueModePromptOverride(
  userId: string,
  mode: string,
  text: string,
): DialogueModePromptView {
  assertDialogueMode(mode);
  const validated = validateDialogueModePromptText(text);
  const { overrides, corrupt } = loadRawOverrides(userId);
  if (corrupt) {
    logGatewayWarn(
      `[prompt-overrides] 用户 ${userId} 存在损坏配置，本次写入将重建该键（其余模式回落默认）。`,
    );
  }
  const next: ModeOverrides = { ...overrides, [mode]: validated };
  persistOverrides(userId, next);
  return buildModeView(mode, next[mode]);
}

/**
 * 恢复指定模式的默认值。
 *
 * 幂等分支只覆盖「配置健康且该模式本就无覆盖」：损坏配置必须借这次重置重建，
 * 否则损坏键永远清不掉，而 UI 的「恢复默认」按钮按 `hasOverride` 判定、在 corrupt
 * 下恰好禁用，用户会被卡在「配置损坏但无法修复」（复查修复）。
 */
export function resetDialogueModePromptOverride(
  userId: string,
  mode: string,
): DialogueModePromptView {
  assertDialogueMode(mode);
  const { overrides, corrupt } = loadRawOverrides(userId);
  if (overrides[mode] === undefined && !corrupt) {
    return buildModeView(mode, undefined);
  }
  const next: ModeOverrides = { ...overrides };
  delete next[mode];
  persistOverrides(userId, next);
  return buildModeView(mode, undefined);
}
