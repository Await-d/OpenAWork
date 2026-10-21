/**
 * team-conversation-view-inline-interactions · `<TeamConversationView/>` 行内 Q/P 回复
 *
 * 承载对话流内联的澄清问题（question）与权限请求（permission）的本地状态与
 * 回复动作：answer/dismiss 组装、权限决策提交、失败/过期重新同步、scope 选择。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveAlwaysScopeSelection, type AlwaysScopeLevel } from '@openAwork/shared-ui';
import type { PendingPermissionRequest, PermissionDecision } from '@openAwork/web-client';
import {
  applyPermissionDecisionToLocalAssistantMessages,
  dismissPermissionEventMessage,
} from '../../../components/conversation-runtime/messages/support.js';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import {
  getPermissionReplyStatusCode,
  getPermissionReplySuccessMessage,
} from '../../../utils/permission/permission-reply.js';
import type { TeamConversationState } from './use-team-conversation-state.js';

/**
 * 行内权限回复的统一包装：run 全流程留在 try 内，catch 交给 onError，finally 收尾。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 try/catch 的 finally 子句，也不支持 try 内的
 * 值块（`...(cond ? … : {})`、三元）。语义逐字照搬。
 */
async function runInlinePermissionReplyOnce(ctx: {
  onError: (error: unknown) => void;
  onFinally: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  } finally {
    ctx.onFinally();
  }
}

/**
 * 把自定义输入并入各题答案（仅 answered 且该题有自定义输入时追加）。
 *
 * 必须留在模块级：`?.` / 三元在 try 内属于值块，会让编译器报
 * "Support value blocks ... within a try/catch statement" 并放弃优化整个 hook（实测）。
 */
function mergeInlineQuestionAnswers(
  answers: readonly string[][],
  customInputs: readonly string[],
  status: 'answered' | 'dismissed',
): string[][] {
  return answers.map((row, idx) => {
    const custom = customInputs[idx]?.trim();
    if (status === 'answered' && custom) return [...row, custom];
    return row;
  });
}

export function useTeamConversationViewInlineInteractions(input: { state: TeamConversationState }) {
  const { state } = input;

  const [inlineQuestionAnswers, setInlineQuestionAnswers] = useState<string[][]>([]);
  const [inlineQuestionCustomInputs, setInlineQuestionCustomInputs] = useState<string[]>([]);
  const [inlineQuestionReplyStatus, setInlineQuestionReplyStatus] = useState<
    'answered' | 'dismissed' | null
  >(null);
  const [inlineQuestionReplyError, setInlineQuestionReplyError] = useState<string | null>(null);
  const [inlinePermissionPendingDecision, setInlinePermissionPendingDecision] = useState<{
    decision: PermissionDecision;
    requestId: string;
  } | null>(null);
  const [inlinePermissionErrors, setInlinePermissionErrors] = useState<Record<string, string>>({});
  const [selectedPermissionScopeLevels, setSelectedPermissionScopeLevels] = useState<
    Record<string, AlwaysScopeLevel>
  >({});
  const activePendingQuestion = state.pendingQuestions[0] ?? null;
  const activeQuestionIdRef = useRef<string | null>(null);
  const pendingPermissionsById = useMemo(
    () => new Map(state.pendingPermissions.map((permission) => [permission.requestId, permission])),
    [state.pendingPermissions],
  );

  // Reset inline answers state when the active question changes.
  useEffect(() => {
    const nextId = activePendingQuestion?.requestId ?? null;
    if (activeQuestionIdRef.current === nextId) return;
    activeQuestionIdRef.current = nextId;
    if (activePendingQuestion) {
      setInlineQuestionAnswers(activePendingQuestion.questions.map(() => []));
      setInlineQuestionCustomInputs(activePendingQuestion.questions.map(() => ''));
    } else {
      setInlineQuestionAnswers([]);
      setInlineQuestionCustomInputs([]);
    }
    setInlineQuestionReplyStatus(null);
    setInlineQuestionReplyError(null);
  }, [activePendingQuestion]);

  const onToggleInlineQuestionOption = useCallback(
    (questionIndex: number, optionLabel: string, multiple: boolean) => {
      setInlineQuestionAnswers((prev) => {
        const next = prev.map((arr) => arr.slice());
        const current = next[questionIndex] ?? [];
        if (current.includes(optionLabel)) {
          next[questionIndex] = current.filter((v) => v !== optionLabel);
        } else if (multiple) {
          next[questionIndex] = [...current, optionLabel];
        } else {
          next[questionIndex] = [optionLabel];
        }
        return next;
      });
    },
    [],
  );

  const onChangeInlineQuestionCustomInput = useCallback((questionIndex: number, value: string) => {
    setInlineQuestionCustomInputs((prev) => {
      const next = prev.slice();
      next[questionIndex] = value;
      return next;
    });
  }, []);

  const onReplyInlineQuestion = useCallback(
    async (status: 'answered' | 'dismissed') => {
      if (!activePendingQuestion) return;
      setInlineQuestionReplyError(null);
      // Merge custom inputs into answers when present.
      // 合并逻辑（含 `?.` / 三元）下沉到模块级 `mergeInlineQuestionAnswers`；三元取值也
      // 移到 try 之外（值块会让编译器脱靶）。
      const mergedAnswers = mergeInlineQuestionAnswers(
        inlineQuestionAnswers,
        inlineQuestionCustomInputs,
        status,
      );
      const answersToSend = status === 'answered' ? mergedAnswers : undefined;
      try {
        await state.replyQuestion(activePendingQuestion.requestId, status, answersToSend, {
          targetSessionId: activePendingQuestion.sessionId,
        });
        setInlineQuestionReplyStatus(status);
      } catch (err) {
        setInlineQuestionReplyError(err instanceof Error ? err.message : '回复失败');
      }
    },
    [activePendingQuestion, inlineQuestionAnswers, inlineQuestionCustomInputs, state],
  );

  const handleInlinePermissionDecision = useCallback(
    async (request: PendingPermissionRequest, decision: PermissionDecision) => {
      setInlinePermissionPendingDecision({
        decision,
        requestId: request.requestId,
      });
      setInlinePermissionErrors((previous) => {
        const next = { ...previous };
        delete next[request.requestId];
        return next;
      });

      const selectedScopeLevel =
        selectedPermissionScopeLevels[request.requestId] ??
        resolveAlwaysScopeSelection(request.previewAction, request.scope, request.always)
          .selectedLevel;
      const alwaysOverride =
        decision !== 'once' && decision !== 'reject' && selectedScopeLevel
          ? [selectedScopeLevel.pattern]
          : undefined;

      // try/catch/finally 下沉到模块级 `runInlinePermissionReplyOnce`（见其注释）。
      await runInlinePermissionReplyOnce({
        onError: (error) => {
          const status = getPermissionReplyStatusCode(error);
          const errorMessage = error instanceof Error ? error.message : '权限处理失败，请重试。';
          if (status === 404 || status === 409) {
            state.setPendingPermissions((previous) =>
              previous.filter((permission) => permission.requestId !== request.requestId),
            );
            toast('该权限请求已被处理或已过期，已重新同步。', 'warning', 3000);
            return;
          }
          setInlinePermissionErrors((previous) => ({
            ...previous,
            [request.requestId]: errorMessage,
          }));
        },
        onFinally: () => {
          setInlinePermissionPendingDecision((current) =>
            current?.requestId === request.requestId ? null : current,
          );
        },
        run: async () => {
          await state.replyPermission(request.requestId, decision, {
            ...(alwaysOverride ? { alwaysOverride } : {}),
            targetSessionId: request.sessionId,
          });
          setInlinePermissionErrors((previous) => {
            const next = { ...previous };
            delete next[request.requestId];
            return next;
          });
          state.setMessages((previous) =>
            dismissPermissionEventMessage(
              applyPermissionDecisionToLocalAssistantMessages(
                previous,
                request.requestId,
                decision,
              ),
              request.requestId,
            ),
          );
          toast(
            getPermissionReplySuccessMessage(decision),
            decision === 'reject' ? 'warning' : 'success',
            2200,
          );
        },
      });
    },
    [selectedPermissionScopeLevels, state],
  );

  const resolveInlinePermissionActions = useCallback(
    (requestId: string) => {
      const request = pendingPermissionsById.get(requestId);
      if (!request) {
        return undefined;
      }

      const pendingDecision =
        inlinePermissionPendingDecision?.requestId === requestId
          ? inlinePermissionPendingDecision.decision
          : null;
      const disabled = pendingDecision !== null;
      const { levels: scopeLevels, selectedLevel } = resolveAlwaysScopeSelection(
        request.previewAction,
        request.scope,
        request.always,
      );
      const selectedScopeLevel = selectedPermissionScopeLevels[requestId] ?? selectedLevel;

      return {
        items: [
          {
            id: 'session',
            label: pendingDecision === 'session' ? '处理中…' : '本会话允许',
            disabled,
            hint: '仅在当前会话内记住这次授权选择，适合继续当前任务。',
            primary: true,
            onClick: () => void handleInlinePermissionDecision(request, 'session'),
          },
          {
            id: 'once',
            label: pendingDecision === 'once' ? '处理中…' : '允许一次',
            disabled,
            hint: '只批准当前这一次工具调用，不保留后续授权。',
            onClick: () => void handleInlinePermissionDecision(request, 'once'),
          },
          {
            id: 'permanent',
            label: pendingDecision === 'permanent' ? '处理中…' : '永久允许',
            disabled,
            hint: '会记住后续同类请求，请在充分确认风险后再使用。',
            onClick: () => void handleInlinePermissionDecision(request, 'permanent'),
          },
          {
            id: 'reject',
            label: pendingDecision === 'reject' ? '处理中…' : '拒绝',
            danger: true,
            disabled,
            hint: '阻止本次调用，工具不会继续执行。',
            onClick: () => void handleInlinePermissionDecision(request, 'reject'),
          },
        ],
        pendingLabel: pendingDecision
          ? '正在提交审批结果…'
          : '推荐：本会话允许 · 临时：允许一次 · 持久：永久允许',
        helperMessage: pendingDecision ? undefined : '永久允许会记住后续同类请求，请谨慎选择。',
        errorMessage: inlinePermissionErrors[requestId],
        scopeLevels,
        selectedScopeCategory: selectedScopeLevel?.category,
        selectedScopePattern: selectedScopeLevel?.pattern,
        onSelectScopeLevel: (level: AlwaysScopeLevel) => {
          setSelectedPermissionScopeLevels((previous) => ({
            ...previous,
            [requestId]: level,
          }));
        },
      };
    },
    [
      handleInlinePermissionDecision,
      inlinePermissionErrors,
      inlinePermissionPendingDecision,
      pendingPermissionsById,
      selectedPermissionScopeLevels,
    ],
  );

  return {
    activePendingQuestion,
    inlineQuestionAnswers,
    inlineQuestionCustomInputs,
    inlineQuestionReplyError,
    inlineQuestionReplyStatus,
    onChangeInlineQuestionCustomInput,
    onReplyInlineQuestion,
    onToggleInlineQuestionOption,
    resolveInlinePermissionActions,
  };
}
