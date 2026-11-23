import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { downloadExport, exportMessages } from '../../../components/chat/message/message-export.js';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';

interface ComposerInsertDetail {
  readonly mode?: 'append' | 'replace';
  readonly text?: string;
}

interface UseChatPageWindowEventsInput {
  /**
   * 页面是否处于激活态（`CachedRouteOutlet` 的 keep-alive 路由下，非活动页面
   * 保持挂载，可同时存在多个 ChatPage 实例）。四个事件都是 **window 级**广播，
   * 必须只在激活实例上生效，否则非活动实例会一起响应：`export-chat` 被各实例
   * 各导出一次、`composer:insert` 会把文本插入到非当前会话的输入框。
   *
   * 未激活时**不注册监听**（并入 effect 依赖，失活即清理、激活即重挂），
   * 而非「始终注册、在 handler 内判定」——后者仍会让每个实例挂一份监听器。
   */
  readonly isPageActive: boolean;
  /**
   * messages 的 ref 镜像。订阅回调经它读取**最新**消息列表，因此订阅本身
   * **不依赖** `messages`——否则流式期间每个 token delta 都会拆除并重装监听器，
   * 拆除→重装之间存在事件丢失窗口，且注册时机不可静态证明。
   */
  readonly messagesRef: RefObject<ChatMessage[]>;
  /**
   * `/browser` 预览编排的最新实现（由调用方用无依赖 effect 每帧刷新）。
   * chat 侧语义是「打开最新预览地址」，因此这里必须经 ref 读取最新值，
   * 而**不是**照搬 team 侧「显式传默认 URL」的写法。
   */
  readonly openBrowserPreviewRef: RefObject<((url?: string) => void) | null>;
  readonly setInput: Dispatch<SetStateAction<string>>;
  readonly setShowTemplatePanel: Dispatch<SetStateAction<boolean>>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * ChatPage 的窗口级自定义事件订阅（slash command / 面板广播）。
 *
 * 四个事件：
 *  - `openAwork:open-templates` → 打开模板面板；
 *  - `openAwork:export-chat`    → 把**最新** messages 导出为 Markdown 并下载；
 *  - `openAwork:open-browser`   → 打开**最新**预览地址（chat 侧语义）；
 *  - `openawork:composer:insert`→ append / replace 输入框内容并在下一帧聚焦。
 *
 * 订阅与「读什么」彻底解耦：所有会随时间变化的输入（messages / 预览编排）都经
 * ref 读取，因此 effect 依赖里**不含** messages，只有真正改变事件集时才重装。
 *
 * 同时按页面激活态门控：仅 `isPageActive` 为真时注册窗口监听（见入参说明）。
 */
export function useChatPageWindowEvents(input: UseChatPageWindowEventsInput): void {
  const {
    isPageActive,
    messagesRef,
    openBrowserPreviewRef,
    setInput,
    setShowTemplatePanel,
    textareaRef,
  } = input;

  useEffect(() => {
    // 非活动页面（keep-alive 缓存路由下保持挂载）不得响应 window 级广播：
    // 不注册监听，事件集因此天然只在激活实例上生效。
    if (!isPageActive) return;

    const handleOpenTemplates = () => setShowTemplatePanel(true);
    const handleExportChat = () => {
      const content = exportMessages(messagesRef.current, 'markdown');
      downloadExport(content, `chat-export-${Date.now()}.md`, 'text/markdown');
      toast('对话已导出为 Markdown', 'success');
    };
    const handleOpenBrowser = () => openBrowserPreviewRef.current?.();
    const handleComposerInsert = (event: Event) => {
      const detail = (event as CustomEvent<ComposerInsertDetail>).detail;
      const insertText = detail?.text;
      if (typeof insertText !== 'string' || insertText.length === 0) return;
      setInput((prev) => {
        if (detail?.mode === 'replace') return insertText;
        // append：输入为空时不加前导换行，否则 trim 末尾后以换行连接。
        if (prev.trim().length === 0) return insertText;
        return `${prev.trimEnd()}\n${insertText}`;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    };

    window.addEventListener('openAwork:open-templates', handleOpenTemplates);
    window.addEventListener('openAwork:export-chat', handleExportChat);
    window.addEventListener('openAwork:open-browser', handleOpenBrowser);
    window.addEventListener('openawork:composer:insert', handleComposerInsert);
    return () => {
      window.removeEventListener('openAwork:open-templates', handleOpenTemplates);
      window.removeEventListener('openAwork:export-chat', handleExportChat);
      window.removeEventListener('openAwork:open-browser', handleOpenBrowser);
      window.removeEventListener('openawork:composer:insert', handleComposerInsert);
    };
  }, [
    isPageActive,
    messagesRef,
    openBrowserPreviewRef,
    setInput,
    setShowTemplatePanel,
    textareaRef,
  ]);
}
