/**
 * FusionChatRegion —— fusion 分支的 `<ChatConversationView>` 渲染区域。
 *
 * P1 组装层瘦身：本容器消费 `useChatConversationViewProps` 产出的公共
 * `model`，只负责 fusion 专属的 `topBar` / `compact` 插槽，不再重复公共 prop 列表。
 *
 * - 布局：共用 `ChatConversationView`，`compact` 固定为 true（Fusion 紧凑外壳）。
 * - 顶栏：`ChatTopBar`（density=compact、隐藏右栏开关）+ 多选工具条 + 工作流条。
 *
 * 行为、样式、`data-*` 语义与拆分前完全一致——纯结构搬移。
 */

import type { ReactElement } from 'react';
import { ChatTopBar } from '../../../components/chat/session/ChatTopBar.js';
import { SessionTerminalsChip } from '../../../components/chat/terminal/SessionTerminalsChip.js';
import { MultiSelectToolbar } from '../../../components/chat/message/message-multi-select.js';
import {
  copyExportToClipboard,
  downloadExport,
  exportMessages,
} from '../../../components/chat/message/message-export.js';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import { WorkflowRuntimeStatusStrip } from '../panels/WorkflowRuntimeStatusStrip.js';
import { ChatTerminalToggle } from '../panels/ChatTerminalToggle.js';
import { ChatConversationView } from '../conversation/ChatConversationView.js';
import type { ChatConversationViewModel } from '../conversation/use-chat-conversation-view-props.js';

export interface FusionChatRegionProps {
  readonly model: ChatConversationViewModel;
}

export function FusionChatRegion({ model }: FusionChatRegionProps): ReactElement {
  const { chrome, ...view } = model;
  const { sessionId, gatewayUrl, token, rightOpen, dialogueMode, permissionMode, messages } = view;

  return (
    <ChatConversationView
      {...view}
      compact
      topBar={
        <>
          <ChatTopBar
            dialogueMode={dialogueMode}
            onChangeDialogueMode={chrome.onChangeDialogueMode}
            onConfirmClarifySwitch={chrome.onConfirmClarifySwitch}
            clarifySwitchPending={chrome.clarifySwitchPending}
            permissionMode={permissionMode}
            density="compact"
            rightOpen={rightOpen}
            onToggleRightOpen={chrome.onToggleRightOpen}
            hideRightPanelToggle
            terminalsChip={
              sessionId ? (
                <SessionTerminalsChip
                  terminals={chrome.sessionTerminals.terminals}
                  runningCount={chrome.sessionTerminals.runningCount}
                  loading={chrome.sessionTerminals.loading}
                  error={chrome.sessionTerminals.error}
                  pendingKillIds={chrome.sessionTerminals.pendingKillIds}
                  onKillTerminal={chrome.sessionTerminals.killTerminal}
                  onReload={chrome.sessionTerminals.reload}
                  gatewayUrl={gatewayUrl}
                  token={token}
                  sessionId={sessionId}
                  syncing={chrome.sessionTerminals.syncing}
                  lastSyncedAtMs={chrome.sessionTerminals.lastSyncedAtMs}
                />
              ) : null
            }
            quickTerminalToggle={
              sessionId ? (
                <ChatTerminalToggle
                  terminalPanelOpened={chrome.terminalPanelOpened}
                  onToggleTerminalPanel={chrome.onToggleTerminalPanel}
                />
              ) : null
            }
            onOpenCommandPalette={chrome.openCommandPalette}
            bookmarkCount={chrome.bookmarkStore.getSessionBookmarks(sessionId ?? '').length}
            multiSelectActive={chrome.multiSelect.multiSelect.enabled}
            onToggleMultiSelect={() => {
              if (chrome.multiSelect.multiSelect.enabled) {
                chrome.multiSelect.disableMultiSelect();
              } else {
                chrome.multiSelect.enableMultiSelect();
                requestAnimationFrame(() => chrome.multiSelect.selectAll(messages));
              }
            }}
            todoController={chrome.todoController}
            todoDetailsId={chrome.todoDetailsId}
            sessionInfo={
              sessionId
                ? {
                    title: `会话 ${sessionId.slice(0, 8)}`,
                    modelLabel: chrome.activeModelOptionLabel ?? chrome.effectiveModelId,
                    modeLabel: chrome.dialogueModeLabel,
                  }
                : undefined
            }
            workspaceBinding={chrome.workspaceBinding}
            reviewPanelOpened={chrome.reviewPanelOpened}
            onToggleReviewPanel={chrome.onToggleReviewPanel}
            terminalPanelOpened={chrome.terminalPanelOpened}
            onToggleTerminalPanel={chrome.onToggleTerminalPanel}
          />
          {chrome.multiSelect.multiSelect.enabled && (
            <MultiSelectToolbar
              selectedCount={chrome.multiSelect.selectedCount}
              onCopy={() => {
                const selected = chrome.multiSelect.getSelectedMessages(messages);
                if (selected.length > 0) {
                  void copyExportToClipboard(selected, 'text').then((ok) => {
                    if (ok) toast(`已复制 ${selected.length} 条消息`, 'success');
                  });
                }
              }}
              onExport={() => {
                const selected = chrome.multiSelect.getSelectedMessages(messages);
                if (selected.length > 0) {
                  const content = exportMessages(selected, 'markdown');
                  downloadExport(content, `chat-selected-${Date.now()}.md`, 'text/markdown');
                  toast(`已导出 ${selected.length} 条消息`, 'success');
                }
              }}
              onBookmark={() => {
                const selected = chrome.multiSelect.getSelectedMessages(messages);
                for (const msg of selected) {
                  if (!chrome.bookmarkStore.isBookmarked(msg.id)) {
                    chrome.bookmarkStore.addBookmark({
                      messageId: msg.id,
                      sessionId: sessionId ?? '',
                      content: msg.content.slice(0, 200),
                      role: msg.role,
                    });
                  }
                }
                toast(`已收藏 ${selected.length} 条消息`, 'success');
                chrome.multiSelect.disableMultiSelect();
              }}
              onSelectAll={() => chrome.multiSelect.selectAll(messages)}
              onCancel={() => chrome.multiSelect.disableMultiSelect()}
            />
          )}
          <WorkflowRuntimeStatusStrip
            runtime={chrome.workflowRuntime}
            tasks={chrome.sessionTasks}
          />
        </>
      }
    />
  );
}
