import type { PendingQuestionRequest } from '@openAwork/web-client';

/**
 * 从一批 pending question 请求里挑出要展示的那条。
 *
 * 背景：流式 `question_asked` chunk 只带 `requestId`/`toolName`/`title`，不含
 * `InlineQuestionPanel` 渲染所需的完整 `questions` 选项数组，所以前端要回拉
 * `/sessions/:id/questions/pending` 拿全量详情。这里负责从返回列表里选中正确的一条：
 * 优先按事件携带的 `requestId` 精确匹配且状态为 pending；找不到时退回到列表里第一条
 * pending（覆盖 requestId 漂移 / 仅有一条待回答的常见场景）。
 */
export function selectPendingQuestionForRequest(
  pending: PendingQuestionRequest[],
  requestId: string,
): PendingQuestionRequest | null {
  return (
    pending.find((q) => q.requestId === requestId && q.status === 'pending') ??
    pending.find((q) => q.status === 'pending') ??
    null
  );
}

/**
 * 把新选中的 pending question 合并进现有队列：去掉同 requestId 的旧条目后置顶，
 * 保证不会重复，也保证最新一条排在最前（与 activePendingQuestion「取第一条 pending」
 * 的派生语义一致）。
 */
export function mergePendingQuestion(
  previous: PendingQuestionRequest[],
  next: PendingQuestionRequest,
): PendingQuestionRequest[] {
  const withoutDuplicate = previous.filter((q) => q.requestId !== next.requestId);
  return [next, ...withoutDuplicate];
}
