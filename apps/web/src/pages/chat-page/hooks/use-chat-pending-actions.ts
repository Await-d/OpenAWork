/**
 * ChatPage 待处理操作域 hook（域 C · Phase C）
 *
 * 聚合"等待用户/远端回应"的请求队列与对应交互：
 * - 待审批的工具权限请求（`pendingPermissions`）
 * - 待回答的澄清问题请求（`pendingQuestions`）
 * - inline 问题回答的本地草稿（多选 / 自填 / 状态 / 错误）
 * - inline 权限审批的当前决策与错误反馈
 * - 派生：`activePendingQuestion`、`pendingPermissionsById`
 * - 派生回调：toggleOption、自填回填、replyInlineQuestion、
 *   handleInlinePermissionDecision、resolveInlinePermissionActions
 * - cross-domain effect：publishSessionPendingPermission /
 *   publishSessionPendingQuestion（观察者通知）
 * - 维护：每当 `activePendingQuestion?.requestId` 变化重置 inline 草稿
 *
 * 设计原则：
 *   1. 流式管线（pre-process + attach）需要直接 push / filter
 *      `pendingPermissions`,因此暴露 `setPendingPermissions` 与
 *      `setPendingQuestions` 让外部继续直写。
 *   2. `useSessionSnapshotLoader` 也需要这两个 setter — 同样直暴露。
 *   3. 跨域副作用（`setMessages` / `setRightPanelState` / `setStreamError`）
 *      由调用方注入,本 hook 不直接感知这些域。
 *   4. publish 通知 effect 内置于本 hook —— 它的依赖只有 `currentSessionId`
 *      与 `pendingPermissions`/`pendingQuestions`,移入此处不会牵连其他域。
 *
 * @see docs/architecture/chat-page-split-plan.md 域 C
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { categorizeAlwaysPatterns, type AlwaysScopeLevel } from '@openAwork/shared-ui';
import {
  createQuestionsClient,
  type PendingPermissionRequest,
  type PendingQuestionRequest,
  type PermissionDecision,
} from '@openAwork/web-client';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import {
  applyPermissionDecisionToLocalAssistantMessages,
  type ChatMessage,
  dismissPermissionEventMessage,
} from '../../../components/conversation-runtime/messages/support.js';
import { toSessionPendingPermissionState } from '../../../components/conversation-runtime/session/session-runtime.js';
import {
  getPermissionReplyStatusCode,
  getPermissionReplySuccessMessage,
  replyPermissionRequest,
} from '../../../utils/permission/permission-reply.js';
import {
  publishSessionPendingPermission,
  publishSessionPendingQuestion,
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
} from '../../../utils/session/session-list-events.js';
import {
  type ChatRightPanelState,
  clearResolvedPendingPermissionToolCalls,
} from '../state/chat-stream-state.js';

export interface UseChatPendingActionsOptions {
  /** 网关地址（用于 sessions/questions client）。 */
  gatewayUrl: string;
  /** 当前用户访问令牌；为 null 时 reply 路径会拒绝并返回。 */
  token: string | null;
  /** 当前会话 id（用于发布通知 + reply 后刷新）。 */
  currentSessionId: string | null;
  /**
   * 修改本地 messages 的 setter。inline 权限决策提交成功后会用它把
   * permission_event 消息收起 + apply decision；流式管线自身保留对
   * 同一 setter 的访问,这里只是回调依赖注入。
   */
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  /**
   * 右栏状态 setter。inline 权限决策提交成功后,需要清除右栏对应的
   * 待审批工具卡。流式管线自身保留对同一 setter 的访问。
   */
  setRightPanelState: React.Dispatch<React.SetStateAction<ChatRightPanelState>>;
  /**
   * 流式错误 setter。当用户未登录但触发了 inline 权限按钮时,通过
   * 它显示"当前未登录,无法处理权限审批"。
   */
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;
}

export interface ChatPendingActions {
  // ─── 队列状态 ─────────────────────────────────────────────────────────
  pendingPermissions: PendingPermissionRequest[];
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermissionRequest[]>>;
  pendingQuestions: PendingQuestionRequest[];
  setPendingQuestions: React.Dispatch<React.SetStateAction<PendingQuestionRequest[]>>;

  // ─── 派生 ────────────────────────────────────────────────────────────
  /** 当前唯一处于 pending 状态的问题（最多一条）。 */
  activePendingQuestion: PendingQuestionRequest | null;

  // ─── inline 问题回答草稿 ────────────────────────────────────────────
  inlineQuestionAnswers: string[][];
  inlineQuestionCustomInputs: string[];
  inlineQuestionReplyStatus: 'answered' | 'dismissed' | null;
  inlineQuestionReplyError: string | null;

  // ─── inline 权限审批 ─────────────────────────────────────────────────
  inlinePermissionPendingDecision: { decision: PermissionDecision; requestId: string } | null;
  inlinePermissionErrors: Record<string, string>;

  // ─── 回调 ────────────────────────────────────────────────────────────
  /** 切换某个问题选项；multiple=true 时支持多选,否则单选互斥。 */
  toggleInlineQuestionOption: (
    questionIndex: number,
    optionLabel: string,
    multiple: boolean,
  ) => void;
  /** 写入某个问题的自填补充文本。 */
  handleInlineQuestionCustomInput: (questionIndex: number, value: string) => void;
  /** 回答 / 忽略当前 active 问题。失败会回填错误,409/404 会自动同步。 */
  replyInlineQuestion: (status: 'answered' | 'dismissed') => Promise<void>;
  /** 用户点击"本会话/一次/永久/拒绝"四按钮之一时调用。 */
  handleInlinePermissionDecision: (
    request: PendingPermissionRequest,
    decision: PermissionDecision,
    feedback?: string,
  ) => Promise<void>;
  /** 给定 requestId 时返回该请求要展示的按钮组与文案；否则 undefined。 */
  resolveInlinePermissionActions: (requestId: string) =>
    | {
        items: Array<{
          id: string;
          label: string;
          disabled?: boolean;
          hint?: string;
          primary?: boolean;
          danger?: boolean;
          onClick: () => void;
        }>;
        pendingLabel: string;
        helperMessage?: string;
        errorMessage?: string;
        scopeLevels?: AlwaysScopeLevel[];
        selectedScopeCategory?: AlwaysScopeLevel['category'];
        selectedScopePattern?: string;
        onSelectScopeLevel?: (level: AlwaysScopeLevel) => void;
      }
    | undefined;
}

export function useChatPendingActions(options: UseChatPendingActionsOptions): ChatPendingActions {
  const { gatewayUrl, token, currentSessionId, setMessages, setRightPanelState, setStreamError } =
    options;

  // ── 队列状态 ──────────────────────────────────────────────────────────
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionRequest[]>([]);

  // ── inline 草稿状态 ───────────────────────────────────────────────────
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

  // ── 派生 ─────────────────────────────────────────────────────────────
  const activePendingQuestion = useMemo(
    () => pendingQuestions.find((q) => q.status === 'pending') ?? null,
    [pendingQuestions],
  );

  const pendingPermissionsById = useMemo(
    () => new Map(pendingPermissions.map((permission) => [permission.requestId, permission])),
    [pendingPermissions],
  );

  // ── 通知观察者：pendingPermissions / pendingQuestions 变化时广播 ─────
  // 侧栏 / 任务面板 / 子会话面板等通过 sessionListEvents 订阅这两个状态,
  // 用于在不持有 ChatPage 实例的前提下显示 badge / 数量。
  useEffect(() => {
    if (!currentSessionId) {
      return;
    }
    publishSessionPendingPermission(
      currentSessionId,
      toSessionPendingPermissionState(pendingPermissions),
    );
  }, [currentSessionId, pendingPermissions]);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }
    publishSessionPendingQuestion(
      currentSessionId,
      pendingQuestions.find((question) => question.status === 'pending') ?? null,
    );
  }, [currentSessionId, pendingQuestions]);

  // ── 当前 active 问题切换时,重置 inline 草稿 ────────────────────────
  useEffect(() => {
    if (!activePendingQuestion) {
      return;
    }
    setInlineQuestionAnswers(activePendingQuestion.questions.map(() => []));
    setInlineQuestionCustomInputs(activePendingQuestion.questions.map(() => ''));
    setInlineQuestionReplyStatus(null);
    setInlineQuestionReplyError(null);
  }, [activePendingQuestion?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── inline 问题草稿编辑 ───────────────────────────────────────────────
  const toggleInlineQuestionOption = useCallback(
    (questionIndex: number, optionLabel: string, multiple: boolean) => {
      setInlineQuestionAnswers((prev) => {
        const next = prev.map((a) => [...a]);
        while (next.length <= questionIndex) {
          next.push([]);
        }
        const current = next[questionIndex] ?? [];
        if (multiple) {
          next[questionIndex] = current.includes(optionLabel)
            ? current.filter((a) => a !== optionLabel)
            : [...current, optionLabel];
        } else {
          next[questionIndex] = current.includes(optionLabel) ? [] : [optionLabel];
        }
        return next;
      });
    },
    [],
  );

  const handleInlineQuestionCustomInput = useCallback((questionIndex: number, value: string) => {
    setInlineQuestionCustomInputs((prev) => {
      const next = [...prev];
      while (next.length <= questionIndex) {
        next.push('');
      }
      next[questionIndex] = value;
      return next;
    });
  }, []);

  // ── 提交 inline 问题回答 ──────────────────────────────────────────────
  const replyInlineQuestion = useCallback(
    async (status: 'answered' | 'dismissed') => {
      if (!token || !activePendingQuestion) {
        return;
      }

      const mergedAnswers = activePendingQuestion.questions.map((_, index) => {
        const selected = inlineQuestionAnswers[index] ?? [];
        const custom = (inlineQuestionCustomInputs[index] ?? '').trim();
        return custom ? [...selected, custom] : selected;
      });

      const payload =
        status === 'answered'
          ? {
              answers: mergedAnswers,
              requestId: activePendingQuestion.requestId,
              status,
            }
          : { requestId: activePendingQuestion.requestId, status };

      try {
        setInlineQuestionReplyStatus(status);
        setInlineQuestionReplyError(null);
        await createQuestionsClient(gatewayUrl).reply(
          token,
          activePendingQuestion.sessionId,
          payload,
        );
        setPendingQuestions((prev) =>
          prev.filter((q) => q.requestId !== activePendingQuestion.requestId),
        );
        if (currentSessionId) {
          requestCurrentSessionRefresh(currentSessionId);
        }
        requestSessionListRefresh();
      } catch (error) {
        const isHttp =
          typeof error === 'object' &&
          error !== null &&
          typeof Reflect.get(error, 'status') === 'number';
        if (isHttp) {
          const httpStatus = Reflect.get(error, 'status') as number;
          const data = Reflect.get(error, 'data') as { error?: string } | undefined;
          if (
            (httpStatus === 409 || httpStatus === 404) &&
            (data?.error === 'Question request expired' ||
              data?.error === 'Question request already resolved' ||
              httpStatus === 404)
          ) {
            setPendingQuestions((prev) =>
              prev.filter((q) => q.requestId !== activePendingQuestion.requestId),
            );
            toast('问题已过期或已处理，已重新同步。', 'warning', 3000);
            if (currentSessionId) {
              requestCurrentSessionRefresh(currentSessionId);
            }
            requestSessionListRefresh();
            return;
          }
        }
        setInlineQuestionReplyError(
          error instanceof Error ? error.message : '提交回答失败，请重试。',
        );
      } finally {
        setInlineQuestionReplyStatus(null);
      }
    },
    [
      token,
      gatewayUrl,
      activePendingQuestion,
      currentSessionId,
      inlineQuestionAnswers,
      inlineQuestionCustomInputs,
    ],
  );

  // ── 提交 inline 权限决策 ──────────────────────────────────────────────
  // refreshSessionsAfterInlinePermissionReply：成功 / 404 / 409 后重复触发
  // sessionList + currentSession refresh,2 秒后再补一发,确保侧栏 / 任务
  // 面板的 badge 同步。closure-only,只在这里使用。
  const refreshSessionsAfterInlinePermissionReply = useCallback(
    (targetSessionId: string) => {
      const refreshTargets = new Set<string>();
      if (currentSessionId) {
        refreshTargets.add(currentSessionId);
      }
      refreshTargets.add(targetSessionId);

      const flushRefresh = () => {
        refreshTargets.forEach((sessionIdItem) => {
          requestCurrentSessionRefresh(sessionIdItem);
        });
        requestSessionListRefresh();
      };

      flushRefresh();
      window.setTimeout(() => {
        flushRefresh();
      }, 2000);
    },
    [currentSessionId],
  );

  const handleInlinePermissionDecision = useCallback(
    async (request: PendingPermissionRequest, decision: PermissionDecision, feedback?: string) => {
      if (!token) {
        setStreamError('当前未登录，无法处理权限审批。');
        return;
      }

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
        categorizeAlwaysPatterns(request.previewAction, request.scope, request.always).at(-1);
      const alwaysOverride = selectedScopeLevel ? [selectedScopeLevel.pattern] : [];

      try {
        await replyPermissionRequest({
          ...(decision !== 'once' && decision !== 'reject' && alwaysOverride.length > 0
            ? { alwaysOverride }
            : {}),
          decision,
          feedback,
          gatewayUrl,
          requestId: request.requestId,
          sessionId: request.sessionId,
          token,
        });
        const successMessage = getPermissionReplySuccessMessage(decision);
        setMessages((previous) =>
          dismissPermissionEventMessage(
            applyPermissionDecisionToLocalAssistantMessages(
              previous,
              request.requestId,
              decision,
              feedback,
            ),
            request.requestId,
          ),
        );
        setPendingPermissions((previous) =>
          previous.filter((permission) => permission.requestId !== request.requestId),
        );
        setRightPanelState((previous) =>
          clearResolvedPendingPermissionToolCalls(previous, request.requestId, decision),
        );
        toast(successMessage, decision === 'reject' ? 'warning' : 'success', 2200);
        refreshSessionsAfterInlinePermissionReply(request.sessionId);
      } catch (error) {
        const status = getPermissionReplyStatusCode(error);
        const errorMessage = error instanceof Error ? error.message : '权限处理失败，请重试。';

        if (status === 404 || status === 409) {
          setPendingPermissions((previous) =>
            previous.filter((permission) => permission.requestId !== request.requestId),
          );
          refreshSessionsAfterInlinePermissionReply(request.sessionId);
        } else {
          setInlinePermissionErrors((previous) => ({
            ...previous,
            [request.requestId]: errorMessage,
          }));
        }
      } finally {
        setInlinePermissionPendingDecision((current) =>
          current?.requestId === request.requestId ? null : current,
        );
      }
    },
    [
      gatewayUrl,
      refreshSessionsAfterInlinePermissionReply,
      setMessages,
      setRightPanelState,
      setStreamError,
      selectedPermissionScopeLevels,
      token,
    ],
  );

  // ── 把请求映射成按钮组 ────────────────────────────────────────────────
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
      const scopeLevels = categorizeAlwaysPatterns(
        request.previewAction,
        request.scope,
        request.always,
      );
      const selectedScopeLevel =
        selectedPermissionScopeLevels[requestId] ?? scopeLevels[scopeLevels.length - 1];

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
    pendingPermissions,
    setPendingPermissions,
    pendingQuestions,
    setPendingQuestions,

    activePendingQuestion,

    inlineQuestionAnswers,
    inlineQuestionCustomInputs,
    inlineQuestionReplyStatus,
    inlineQuestionReplyError,

    inlinePermissionPendingDecision,
    inlinePermissionErrors,

    toggleInlineQuestionOption,
    handleInlineQuestionCustomInput,
    replyInlineQuestion,
    handleInlinePermissionDecision,
    resolveInlinePermissionActions,
  };
}
