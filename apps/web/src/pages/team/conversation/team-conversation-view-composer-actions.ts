/**
 * team-conversation-view-composer-actions · `<TeamConversationView/>` 的提交 / 重试 / 消息动作
 *
 * 三个 hook 都在 `<TeamConversationView/>` 的原始位置调用，分别承载：
 *   - `useTeamConversationViewComposerDispatch`：统一文本派发（inbound / stream 路由）
 *   - `useTeamConversationViewRetryActions`：停止 / 截断重发 / 编辑重试 / 模型与上下文挡位
 *   - `useTeamConversationViewEntryActions`：每条消息的 hover actions（复制 / 编辑重试 / 重试）
 */

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { InputImageContent } from '@openAwork/shared';
import { createSessionsClient, createSettingsClient } from '@openAwork/web-client';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import { applyRollbackReceipt } from '../../../stores/team/rollback-tombstones.js';
import type { ChatRenderAction } from '../../../components/chat/message/chat-message-group-list.js';
import { copyExportToClipboard } from '../../../components/chat/message/message-export.js';
import { normalizeChatMessages } from '../../../components/conversation-runtime/messages/support.js';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { resolveTeamSubmitStrategy } from './submit/team-submit-router.js';
import { extractInputImageParts } from './team-conversation-input-parts.js';
import type {
  ConversationComposerExtras,
  HistoryEditPromptInput,
  RetryPromptInput,
} from './TeamConversationLayout.js';
import type { TeamConversationState } from './use-team-conversation-state.js';

export const TEAM_CONVERSATION_COMPOSER_EXTRAS: ConversationComposerExtras = {
  // chat-only image / skill / yolo / dialogueMode 仍然关闭——这些功能
  // 依赖 chat 专属管线（ChatPage 的 image-generation hook、skill drawer 等）。
  imageGeneration: false,
  skillRecommendation: false,
  permissionMode: false,
  dialogueModeToggle: false,
  // v1.5：放开这些通用对话能力，与 chat 体验对齐。
  multiSelect: true,
  bookmarks: true,
  promptTemplate: true,
  commandPalette: true,
  agentSwitch: true,
};

export function useTeamConversationViewComposerDispatch(input: { state: TeamConversationState }): {
  dispatchTeamText: (text: string, inputParts?: InputImageContent[]) => Promise<boolean>;
} {
  const { state } = input;

  const dispatchTeamText = useCallback(
    async (text: string, inputParts?: InputImageContent[]): Promise<boolean> => {
      // 每次新的派发尝试先清除上一轮的错误提示，避免旧错误遮挡新内容。
      state.setStreamError(null);
      const strategy = resolveTeamSubmitStrategy(state.roleLayer, state.substate);

      if (strategy.kind === 'inbound') {
        if (strategy.messageType === 'user_input') {
          // user_input 对 reception 根会话必须走 inbound：这是团队自动派发链的入口。
          // 若这里失败再偷偷回退到 stream，会把请求重新送回接待层自己回答，等于绕过
          // team-inbound → reception-orchestrator → pm1/... 整条分层链路。
          // clarifying 下的普通 composer 同样不应回退到 stream，否则会绕过 c runner。
          try {
            await state.submitInbound(strategy.messageType, { text } as never);
            await state.reload();
            // inbound 提交成功后，后端会 fire-and-forget 启动后台流
            // （reception-orchestrator 的 direct 路径调用 runSessionInBackground）。
            // 尝试 attach 到该后台流，以获取逐 token 的流式回复展示。
            // attach 失败（如走了 orchestrate 路径无活跃流）不会影响流程，
            // 前端仍会通过 team-events + 轮询刷新消息。
            // 使用 await 而非 void：确保 streamingRef.current 在返回前被设置，
            // 避免"快速双击回车→第二条消息绕过 streaming 守卫"的竞态。
            await state.attachToSessionStream();
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : '提交输入失败';
            if (state.roleLayer === 'reception' || state.substate === 'clarifying') {
              console.warn('[TeamConversationView] team inbound submit failed:', message);
              state.setStreamError(
                state.substate === 'clarifying'
                  ? `输入提交失败，请重试：${message}`
                  : `需求提交失败，请重试：${message}`,
              );
              return false;
            }
            console.warn(
              '[TeamConversationView] user_input inbound submit failed, falling back to stream:',
              message,
            );
          }
        } else {
          console.warn(
            '[TeamConversationView] inbound messageType not yet supported:',
            strategy.messageType,
          );
        }
      }

      try {
        await state.startStream(text, inputParts ? { inputParts } : undefined);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'stream 请求失败';
        state.setStreamError(message);
        return false;
      }
    },
    [state],
  );

  return { dispatchTeamText };
}

export function useTeamConversationViewRetryActions(input: {
  composerEnabled: boolean;
  dispatchTeamText: (text: string, inputParts?: InputImageContent[]) => Promise<boolean>;
  gatewayUrl: string;
  /** 「查看变更快照」入口（回退成功 toast 的 action）。 */
  onOpenChangesPanel?: () => void;
  sessionId: string;
  state: TeamConversationState;
  token: string | null;
}): {
  findRetrySource: (
    messageId: string,
  ) => { id: string; text: string; inputParts?: InputImageContent[] } | null;
  handleComposerModelSelect: (providerId: string, modelId: string) => Promise<void>;
  handleContextWindowOverrideChange: (value: number | undefined) => Promise<void>;
  handleContinueHistoryEdit: (text: string, editedInputParts?: InputImageContent[]) => void;
  handleResendHistoryEdit: (text: string, editedInputParts?: InputImageContent[]) => void;
  handleRetryCurrent: () => void;
  handleStopStream: () => Promise<void>;
  historyEditPrompt: HistoryEditPromptInput | null;
  retryPrompt: RetryPromptInput | null;
  setHistoryEditPrompt: Dispatch<SetStateAction<HistoryEditPromptInput | null>>;
  setRetryPrompt: Dispatch<SetStateAction<RetryPromptInput | null>>;
} {
  const {
    composerEnabled,
    dispatchTeamText,
    gatewayUrl,
    onOpenChangesPanel,
    sessionId,
    state,
    token,
  } = input;

  const handleStopStream = useCallback(async () => {
    if (!composerEnabled) return;
    await state.stopStream();
  }, [composerEnabled, state]);

  // team 之前把这些全接成 noop；这里补上真实实现：
  //   - 编辑重发（user 消息）：截断到该消息之前 → 用新文本重新 startStream
  //   - 重试（assistant 消息）：回溯到最近的 user 消息 → 截断 → 重发其文本
  // 截断走 sessionsClient.truncateMessages（与 chat 同一后端端点）。
  // team 暂不支持「新建会话重试 / 分支」（无分支会话概念），因此不再向弹窗暴露
  // 对应入口，只保留「当前会话重发 / 追加到末尾」两种真实可用动作。
  const [historyEditPrompt, setHistoryEditPrompt] = useState<HistoryEditPromptInput | null>(null);
  const [retryPrompt, setRetryPrompt] = useState<RetryPromptInput | null>(null);

  const truncateAndResend = useCallback(
    async (sourceMessageId: string, text: string, inputParts?: InputImageContent[]) => {
      // 流式中不允许重试/编辑重发（与正常提交一致的 busy 保护）。
      if (state.streaming) {
        state.setStreamError('正在生成回复，请等待当前回复完成后再重试。');
        return;
      }
      if (!gatewayUrl || !token) {
        state.setStreamError('会话连接未就绪，无法回退并重发。');
        return;
      }
      try {
        const sessionsClient = createSessionsClient(gatewayUrl);
        const { messages: remaining, rollback } = await sessionsClient.truncateMessages(
          token,
          sessionId,
          sourceMessageId,
        );
        // 回执 = 作废窗口：晚到的 WS 事件不能把被回退回合的团队记录复活。
        if (rollback) {
          applyRollbackReceipt(rollback);
        }
        state.setMessages(normalizeChatMessages(remaining));
      } catch (err) {
        // 截断失败必须中止：消息没删成功却继续重发会让回合进入不一致状态。
        const message = err instanceof Error ? err.message : '截断失败';
        console.warn('[TeamConversationView] truncate failed, aborting resend:', message);
        state.setStreamError(`回退失败，已取消重发：${message}`);
        return;
      }
      // 旧回合的过程时间线与流错误不再属于当前视图。
      state.setRunEvents([]);
      state.setStreamError(null);
      // 回退成功必须可见（产品要求不得静默），并给出「查看变更快照」入口。
      toast(
        '已回退到所选消息，后续内容已清除',
        'success',
        undefined,
        onOpenChangesPanel
          ? { action: { label: '查看变更快照', onClick: onOpenChangesPanel } }
          : undefined,
      );
      // 重发也走统一路由（与正常提交一致，避免在 clarifying 环节误绕过 inbound）。
      await dispatchTeamText(text, inputParts);
      // startStream 路径不会自行 reload：主动补一次快照 resync，否则过程时间线残留。
      void state.reload();
    },
    [dispatchTeamText, gatewayUrl, onOpenChangesPanel, sessionId, state, token],
  );

  const handleResendHistoryEdit = useCallback(
    (text: string, editedInputParts?: InputImageContent[]) => {
      if (!historyEditPrompt) return;
      void truncateAndResend(historyEditPrompt.messageId, text, editedInputParts);
      setHistoryEditPrompt(null);
    },
    [historyEditPrompt, truncateAndResend],
  );

  const handleContinueHistoryEdit = useCallback(
    (text: string, editedInputParts?: InputImageContent[]) => {
      // 「追加到末尾」：不截断，直接作为新一条发送（同样走统一路由）。
      void dispatchTeamText(text, editedInputParts);
      setHistoryEditPrompt(null);
    },
    [dispatchTeamText],
  );

  const handleRetryCurrent = useCallback(() => {
    if (!retryPrompt) return;
    void truncateAndResend(
      retryPrompt.messageId,
      retryPrompt.text,
      retryPrompt.inputParts as InputImageContent[] | undefined,
    );
    setRetryPrompt(null);
  }, [retryPrompt, truncateAndResend]);

  const handleComposerModelSelect = useCallback(
    async (providerId: string, modelId: string) => {
      state.setActiveProviderId(providerId);
      state.setActiveModelId(modelId);
    },
    [state],
  );

  const handleContextWindowOverrideChange = useCallback(
    async (value: number | undefined) => {
      if (!token || !state.activeProviderId || !state.activeModelId) {
        throw new Error('当前模型尚未准备好，无法保存上下文挡位。');
      }
      const result = await createSettingsClient(gatewayUrl).putModelContext(token, {
        providerId: state.activeProviderId,
        modelId: state.activeModelId,
        contextWindowOverride: value ?? null,
      });
      state.setProviders((previous) =>
        previous.map((provider) => {
          if (provider.id !== result.providerId) return provider;
          return {
            ...provider,
            defaultModels: provider.defaultModels.map((model) => {
              if (model.id !== result.modelId) return model;
              if (result.contextWindowOverride === null) {
                const { contextWindowOverride: _removed, ...rest } = model;
                return rest;
              }
              return { ...model, contextWindowOverride: result.contextWindowOverride };
            }),
          };
        }),
      );
    },
    [gatewayUrl, state, token],
  );

  // 找某条消息对应的「重试源」：assistant 消息 → 向上回溯到最近 user 消息。
  const findRetrySource = useCallback(
    (messageId: string): { id: string; text: string; inputParts?: InputImageContent[] } | null => {
      const idx = state.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return null;
      for (let i = idx; i >= 0; i--) {
        const m = state.messages[i];
        if (m && m.role === 'user') {
          return { id: m.id, text: m.content };
        }
      }
      return null;
    },
    [state.messages],
  );

  return {
    findRetrySource,
    handleComposerModelSelect,
    handleContextWindowOverrideChange,
    handleContinueHistoryEdit,
    handleResendHistoryEdit,
    handleRetryCurrent,
    handleStopStream,
    historyEditPrompt,
    retryPrompt,
    setHistoryEditPrompt,
    setRetryPrompt,
  };
}

export function useTeamConversationViewEntryActions(input: {
  composerEnabled: boolean;
  findRetrySource: (
    messageId: string,
  ) => { id: string; text: string; inputParts?: InputImageContent[] } | null;
  readOnly: boolean;
  setHistoryEditPrompt: Dispatch<SetStateAction<HistoryEditPromptInput | null>>;
  setRetryPrompt: Dispatch<SetStateAction<RetryPromptInput | null>>;
}): { buildEntryActions: (message: ChatMessage) => ChatRenderAction[] } {
  const { composerEnabled, findRetrySource, readOnly, setHistoryEditPrompt, setRetryPrompt } =
    input;

  const buildEntryActions = useCallback(
    (message: ChatMessage): ChatRenderAction[] => {
      if (readOnly) {
        return [];
      }
      const actions: ChatRenderAction[] = [
        {
          id: 'copy',
          label: '复制',
          title: '复制此消息',
          onClick: () => {
            void copyExportToClipboard([message], 'text');
          },
        },
      ];
      if (composerEnabled) {
        if (message.role === 'user') {
          actions.push({
            id: 'edit-retry',
            label: '编辑重试',
            title: '编辑这条消息并从此处重新发送',
            onClick: () => {
              const inputParts = extractInputImageParts(message.rawContent);
              setRetryPrompt(null);
              setHistoryEditPrompt({
                messageId: message.id,
                text: message.content,
                ...(inputParts && inputParts.length > 0 ? { inputParts } : {}),
              });
            },
          });
        } else if (message.role === 'assistant') {
          actions.push({
            id: 'retry',
            label: '重试',
            title: '从最近一条用户消息重新生成',
            onClick: () => {
              const src = findRetrySource(message.id);
              if (!src) return;
              setHistoryEditPrompt(null);
              setRetryPrompt({
                messageId: src.id,
                text: src.text,
                ...(src.inputParts ? { inputParts: src.inputParts } : {}),
              });
            },
          });
        }
      }
      return actions;
    },
    [composerEnabled, findRetrySource, readOnly],
  );

  return { buildEntryActions };
}
