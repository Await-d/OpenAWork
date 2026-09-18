/**
 * team-conversation-view-helpers · `<TeamConversationView/>` 的纯函数 / 常量提取
 *
 * 这里只放无副作用的展示辅助：CSS 属性转义、disabled composer 占位 action、
 * 角色实例显示名解析、provider / model 派生、占位文案、布局样式。
 * 视图装配仍留在 `TeamConversationView.tsx`，本文件不持有任何状态。
 */

import type { CSSProperties } from 'react';
import { canConfigureThinkingForModel } from '@openAwork/shared-ui';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import type {
  ChatSettingsModel,
  ChatSettingsProvider,
} from '../../../utils/chat/chat-session-defaults.js';
import type { ViewMode } from './extras/TeamViewModeToggle.js';

export const TEAM_CONVERSATION_LAYER_ORDER = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'tester',
  'reviewer',
] as const;

export function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

export async function disabledComposerSubmitAction(): Promise<boolean> {
  return false;
}

export function disabledComposerAction(): void {
  return undefined;
}

export async function disabledComposerAsyncAction(): Promise<void> {
  return Promise.resolve();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRoleInstanceDisplayName(
  metadata: Record<string, unknown> | null,
): string | null {
  const roleInstance = metadata?.['teamRoleInstance'];
  if (!isRecord(roleInstance)) {
    return null;
  }
  const displayName = roleInstance['displayName'];
  return typeof displayName === 'string' && displayName.trim().length > 0
    ? displayName.trim()
    : null;
}

export function buildTeamProviderCatalog(
  providers: ChatSettingsProvider[],
): Map<string, { id: string; name: string; type: string }> {
  const map = new Map<string, { id: string; name: string; type: string }>();
  for (const provider of providers) {
    map.set(provider.id, { id: provider.id, name: provider.name, type: provider.type });
  }
  return map;
}

export function findTeamActiveProvider(
  providers: ChatSettingsProvider[],
  activeProviderId: string,
): ChatSettingsProvider | undefined {
  return providers.find((provider) => provider.id === activeProviderId);
}

export function findTeamActiveModelOption(
  activeProvider: ChatSettingsProvider | undefined,
  activeModelId: string,
): ChatSettingsModel | undefined {
  return activeProvider?.defaultModels.find((model) => model.id === activeModelId);
}

export function resolveTeamActiveModelCanConfigureThinking(input: {
  activeModelId: string;
  activeModelOption: ChatSettingsModel | undefined;
  activeProvider: ChatSettingsProvider | undefined;
}): boolean {
  return canConfigureThinkingForModel(
    input.activeProvider?.type,
    input.activeModelOption?.id ?? input.activeModelId,
    input.activeModelOption?.supportsThinking === true,
  );
}

export function buildTeamActiveModelTooltip(
  activeProvider: ChatSettingsProvider | undefined,
  activeModelOption: ChatSettingsModel | undefined,
): string {
  if (activeModelOption?.label) {
    return `当前使用模型：${activeProvider?.name ? `${activeProvider.name} / ` : ''}${activeModelOption.label}`;
  }
  if (activeProvider?.name) {
    return `当前使用提供商：${activeProvider.name}`;
  }
  return '当前使用模型';
}

export function findTeamLatestFinalizedAssistantId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.role !== 'assistant') continue;
    if (m.status === 'streaming') continue;
    return m.id;
  }
  return null;
}

export function countTeamUserMessages(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}

export function resolveTeamComposerPlaceholder(input: {
  composerPlaceholder?: string;
  roleLayer: string | null;
  streaming: boolean;
  substate: string | null;
}): string {
  if (input.composerPlaceholder) return input.composerPlaceholder;
  if (input.streaming) {
    return '团队正在回复中，可点击停止后再发送…';
  }
  if (input.substate === 'clarifying') {
    return '团队在等你回答澄清问题，直接输入答案后回车发送…';
  }
  if (input.roleLayer === 'reception') {
    return '告诉团队你想做什么，回车发送 · Shift+Enter 换行';
  }
  if (input.roleLayer && input.roleLayer !== 'reception') {
    return '与当前层对话，回车发送 · Shift+Enter 换行';
  }
  return '输入消息与团队对话，回车发送 · Shift+Enter 换行';
}

export const TEAM_CONVERSATION_DUAL_LAYOUT_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};

export const TEAM_CONVERSATION_SOLO_LAYOUT_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

export const TEAM_CONVERSATION_SOLO_MAIN_PANEL_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  // 同主面板容器：fragment 拍平后必须 overflow:hidden 兜底
  overflow: 'hidden',
};

export function resolveTeamConversationMainPanelStyle(viewMode: ViewMode): CSSProperties {
  return {
    flex: viewMode === 'dual' ? '0 0 clamp(360px, 55%, 640px)' : '1 1 100%',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'flex 200ms ease',
  };
}
