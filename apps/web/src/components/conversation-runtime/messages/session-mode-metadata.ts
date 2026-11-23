import type { SessionPermissionMode } from '@openAwork/shared';
import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import {
  parseSessionOrigin,
  UNKNOWN_SESSION_ORIGIN,
  type SessionOrigin,
} from '../../../utils/session/session-origin.js';
import type { ReasoningEffort } from './message-model.js';

/**
 * 读取审批方式档位：以规范字段 `permissionMode` 为准；
 * 旧数据只有布尔 `yoloMode` 时按 `permissionMode ?? (yoloMode ? 'yolo' : 'ask')` 回退。
 */
function normalizeSessionPermissionMode(value: unknown, yoloMode: boolean): SessionPermissionMode {
  if (value === 'ask' || value === 'auto-edit' || value === 'yolo') return value;
  return yoloMode ? 'yolo' : 'ask';
}

export function parseSessionModeMetadata(metadataJson: string | undefined): {
  agentId?: string;
  /** 会话级上下文窗口挡位（`metadata.contextWindowOverride`）；未覆盖时为 undefined。 */
  contextWindowOverride?: number;
  dialogueMode?: DialogueMode;
  /**
   * 会话来源（渠道 / 定时任务）：这些会话**没有**对话模式，网页端必须按只读对待
   *（不渲染模式切换器、不写 `dialogueMode`）。判定见 utils/session/session-origin。
   */
  origin: SessionOrigin;
  permissionMode: SessionPermissionMode;
  yoloMode: boolean;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  modelSelectionSource?: 'metadata' | 'defaults' | 'manual';
  providerId?: string;
  modelId?: string;
} {
  if (!metadataJson) {
    return {
      origin: UNKNOWN_SESSION_ORIGIN,
      permissionMode: 'ask',
      yoloMode: false,
      webSearchEnabled: true,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
    };
  }

  try {
    const parsed = JSON.parse(metadataJson) as {
      channel?: unknown;
      contextWindowOverride?: unknown;
      dialogueMode?: DialogueMode;
      agentId?: string;
      permissionMode?: unknown;
      source?: unknown;
      yoloMode?: boolean;
      webSearchEnabled?: boolean;
      thinkingEnabled?: boolean;
      reasoningEffort?: ReasoningEffort;
      modelSelectionSource?: 'metadata' | 'defaults' | 'manual';
      providerId?: string;
      modelId?: string;
    };
    const permissionMode = normalizeSessionPermissionMode(
      parsed.permissionMode,
      parsed.yoloMode === true,
    );
    return {
      agentId: typeof parsed.agentId === 'string' ? parsed.agentId : undefined,
      contextWindowOverride:
        typeof parsed.contextWindowOverride === 'number' &&
        Number.isInteger(parsed.contextWindowOverride) &&
        parsed.contextWindowOverride > 0
          ? parsed.contextWindowOverride
          : undefined,
      dialogueMode:
        parsed.dialogueMode === 'clarify' ||
        parsed.dialogueMode === 'coding' ||
        parsed.dialogueMode === 'programmer'
          ? parsed.dialogueMode
          : undefined,
      permissionMode,
      origin: parseSessionOrigin(parsed),
      // 布尔字段只作为档位的派生投影返回，保证两个字段不会互相矛盾。
      yoloMode: permissionMode === 'yolo',
      webSearchEnabled: parsed.webSearchEnabled !== false,
      thinkingEnabled: parsed.thinkingEnabled === true,
      reasoningEffort:
        parsed.reasoningEffort === 'none' ||
        parsed.reasoningEffort === 'minimal' ||
        parsed.reasoningEffort === 'low' ||
        parsed.reasoningEffort === 'medium' ||
        parsed.reasoningEffort === 'high' ||
        parsed.reasoningEffort === 'xhigh' ||
        parsed.reasoningEffort === 'max'
          ? parsed.reasoningEffort
          : 'medium',
      modelSelectionSource:
        parsed.modelSelectionSource === 'metadata' ||
        parsed.modelSelectionSource === 'defaults' ||
        parsed.modelSelectionSource === 'manual'
          ? parsed.modelSelectionSource
          : undefined,
      providerId: typeof parsed.providerId === 'string' ? parsed.providerId : undefined,
      modelId: typeof parsed.modelId === 'string' ? parsed.modelId : undefined,
    };
  } catch {
    return {
      agentId: undefined,
      dialogueMode: 'clarify',
      origin: UNKNOWN_SESSION_ORIGIN,
      permissionMode: 'ask',
      yoloMode: false,
      webSearchEnabled: true,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
    };
  }
}
