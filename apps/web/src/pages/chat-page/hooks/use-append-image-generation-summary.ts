import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { makeOrderedMessageId } from '../../../components/conversation-runtime/messages/ordered-id.js';
import {
  estimateTokenCount,
  type ChatMessage,
} from '../../../components/conversation-runtime/messages/support.js';

type ImageGenerationSummaryInput = {
  artifactTitle: string;
  messageSummary: string;
  modelId: string;
  providerId: string;
  revisedPrompt: string | null;
  sourcePrompt: string;
};

type UseAppendImageGenerationSummaryDeps = {
  readonly setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
};

/**
 * 把一次图片生成的结果（产物标题 / 提示词改写情况）作为助手消息追加到对话。
 */
export function useAppendImageGenerationSummary(deps: UseAppendImageGenerationSummaryDeps) {
  const { setMessages } = deps;

  return useCallback(
    (input: ImageGenerationSummaryInput) => {
      const revisedPromptText = input.revisedPrompt?.trim();
      const content =
        revisedPromptText && revisedPromptText !== input.sourcePrompt.trim()
          ? `${input.messageSummary}\n结果：${input.artifactTitle}\n提示词改写：${revisedPromptText}\n已写入产物工作区。`
          : `${input.messageSummary}\n结果：${input.artifactTitle}\n已写入产物工作区。`;
      const createdAt = Date.now();

      setMessages((previous) => [
        ...previous,
        {
          id: makeOrderedMessageId(createdAt),
          role: 'assistant',
          content,
          createdAt,
          model: input.modelId,
          providerId: input.providerId,
          status: 'completed',
          tokenEstimate: estimateTokenCount(content),
        },
      ]);
      // setMessages（会话状态 hook 的 setter，身份稳定）列入依赖：原 deps 为空，
      // 编译器校验既有 memo 时要求补上，行为不变。
    },
    [setMessages],
  );
}
