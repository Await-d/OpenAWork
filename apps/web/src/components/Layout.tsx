import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AppSidebar from './layout/AppSidebar.js';
import { CachedRouteOutlet } from './common/routing/CachedRouteOutlet.js';
import QuestionPromptCard from './common/display/QuestionPromptCard.js';
import { useUIStateStore } from '../stores/ui/uiState.js';
import { useNavigate, useLocation } from 'react-router';
import { useAuthStore } from '../stores/auth/auth.js';
import { CommandPalette, PermissionConfirmDialog } from '@openAwork/shared-ui';
import type { CommandItem, PermissionItem } from '@openAwork/shared-ui';
import { useCommandRegistry } from '../hooks/command/useCommandRegistry.js';
import { preloadRouteModuleByPath } from '../routes/preloadable-route-modules.js';
import { createQuestionsClient, createSessionsClient } from '@openAwork/web-client';
import type { PendingQuestionRequest, SessionSearchResult } from '@openAwork/web-client';
import {
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
  subscribeCurrentSessionRefresh,
  subscribeSessionPendingPermission,
  subscribeSessionPendingQuestion,
} from '../utils/session/session-list-events.js';
import {
  toSessionPendingPermissionStateFromRequest,
  type SessionPendingPermissionState,
} from '../utils/permission/pending-permission-state.js';
import { toast } from './common/feedback/ToastNotification.js';
import { getRecoveryPendingInteractions } from './conversation-runtime/session/recovery-read-model.js';
import { FloatingPermissionPrompt } from './layout/FloatingPermissionPrompt.js';

type PendingQuestionReplyStatus = 'answered' | 'dismissed';

function resolveQuestionReplyError(error: unknown): {
  dismissPrompt: boolean;
  inlineMessage: string;
  toastMessage?: string;
} {
  const httpError =
    typeof error === 'object' && error !== null && typeof Reflect.get(error, 'status') === 'number'
      ? {
          status: Reflect.get(error, 'status') as number,
          data: Reflect.get(error, 'data') as { error?: string } | undefined,
        }
      : null;

  if (httpError) {
    if (httpError.status === 409 && httpError.data?.error === 'Question request expired') {
      return {
        dismissPrompt: true,
        inlineMessage: '该问题已过期，正在重新同步。',
        toastMessage: '问题已过期，已重新同步状态。',
      };
    }

    if (httpError.status === 409 && httpError.data?.error === 'Question request already resolved') {
      return {
        dismissPrompt: true,
        inlineMessage: '该问题已被处理，正在重新同步。',
        toastMessage: '问题已被处理，已重新同步状态。',
      };
    }

    if (httpError.status === 404) {
      return {
        dismissPrompt: true,
        inlineMessage: '问题已不存在，正在重新同步。',
        toastMessage: '问题已不存在，已重新同步状态。',
      };
    }
  }

  return {
    dismissPrompt: false,
    inlineMessage: error instanceof Error ? error.message : '提交回答失败，请重试。',
  };
}

interface LayoutProps {
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onOpenFile?: (path: string, options?: { line?: number; endLine?: number }) => void;
}

export default function Layout({ theme = 'dark', onToggleTheme, onOpenFile }: LayoutProps = {}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);

  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 960 : false,
  );

  const uiState = useUIStateStore();
  const sidebarTab = uiState.sidebarTab;
  const setSidebarTab = uiState.setSidebarTab;
  const expandedDirsArr = uiState.expandedDirs;
  const setExpandedDirsArr = uiState.setExpandedDirs;
  const expandedDirs = new Set(expandedDirsArr);
  const leftSidebarOpen = uiState.leftSidebarOpen;
  const toggleLeftSidebar = uiState.toggleLeftSidebar;
  const setLeftSidebarOpen = uiState.setLeftSidebarOpen;
  const chatView = uiState.chatView;
  const navigateToHome = uiState.navigateToHome;
  const pinnedSessions = uiState.pinnedSessions;
  const togglePinSession = uiState.togglePinSession;
  const isPinned = uiState.isPinned;
  const setExpandedDirs = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === 'function' ? updater(new Set(expandedDirsArr)) : updater;
      setExpandedDirsArr(Array.from(next));
    },
    [expandedDirsArr, setExpandedDirsArr],
  );

  const navigate = useNavigate();
  const location = useLocation();
  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);
  const isChatRoute = location.pathname.startsWith('/chat');
  const currentChatSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] ?? null;
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteSearchResults, setPaletteSearchResults] = useState<SessionSearchResult[]>([]);
  const paletteDescriptors = useCommandRegistry('palette');

  const [pendingPermissionIndicator, setPendingPermissionIndicator] = useState(false);
  const [pendingConfirmDialog, setPendingConfirmDialog] = useState<{
    skillName: string;
    permissions: PermissionItem[];
    trustLevel: 'full' | 'standard' | 'restricted';
  } | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestionRequest | null>(null);
  const [pendingQuestionAnswers, setPendingQuestionAnswers] = useState<string[][]>([]);
  const [pendingQuestionReplyStatus, setPendingQuestionReplyStatus] =
    useState<PendingQuestionReplyStatus | null>(null);
  const [pendingQuestionReplyError, setPendingQuestionReplyError] = useState<string | null>(null);

  const pendingPermissionRef = useRef<SessionPendingPermissionState | null>(null);

  const updatePendingPermission = useCallback((next: SessionPendingPermissionState | null) => {
    // Only update the ref and boolean indicator — the actual PermissionPrompt
    // UI is rendered by FloatingPermissionPrompt which has its own subscription.
    // This avoids triggering a full Layout re-render on permission state changes.
    pendingPermissionRef.current = next;
    setPendingPermissionIndicator(next !== null);
  }, []);

  const applyPendingQuestion = useCallback(
    (
      nextQuestion: PendingQuestionRequest | null,
      options?: { preserveAnswersForSameRequest?: boolean },
    ) => {
      setPendingQuestion((previous) => {
        const nextQuestionId = nextQuestion?.requestId ?? null;
        const preserveAnswers =
          options?.preserveAnswersForSameRequest === true &&
          nextQuestionId !== null &&
          previous?.requestId === nextQuestionId;

        setPendingQuestionReplyStatus(null);
        setPendingQuestionReplyError(null);
        if (!preserveAnswers) {
          setPendingQuestionAnswers(nextQuestion ? nextQuestion.questions.map(() => []) : []);
        }

        return nextQuestion;
      });
    },
    [],
  );

  const loadPendingInteractionState = useCallback(
    async (
      sessionId: string,
      options?: { preserveQuestionAnswersForSameRequest?: boolean; signal?: AbortSignal },
    ) => {
      if (!accessToken) {
        updatePendingPermission(null);
        applyPendingQuestion(null);
        return;
      }

      const recovery = await createSessionsClient(gatewayUrl).getRecovery(accessToken, sessionId, {
        ...options,
        messageLimit: 1,
      });
      const pendingInteractions = getRecoveryPendingInteractions(recovery);
      updatePendingPermission(
        toSessionPendingPermissionStateFromRequest(pendingInteractions.pendingPermission),
      );
      applyPendingQuestion(pendingInteractions.pendingQuestion, {
        preserveAnswersForSameRequest: options?.preserveQuestionAnswersForSameRequest === true,
      });
    },
    [accessToken, applyPendingQuestion, gatewayUrl, updatePendingPermission],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setIsNarrowViewport(window.innerWidth <= 960);
      return;
    }

    const media = window.matchMedia('(max-width: 960px)');
    const updateViewportMode = () => setIsNarrowViewport(media.matches);
    updateViewportMode();
    media.addEventListener('change', updateViewportMode);
    return () => media.removeEventListener('change', updateViewportMode);
  }, []);

  useEffect(() => {
    if (isChatRoute && isNarrowViewport) {
      setLeftSidebarOpen(false);
    }
  }, [isChatRoute, isNarrowViewport, setLeftSidebarOpen]);

  // Global real-time permission subscription: accept events from ANY
  // session so the prompt is actionable even when the user is on a non-chat
  // page (e.g. Skills, Settings).  The targetSessionId inside the payload
  // ensures the reply is sent to the correct session.
  // NOTE: The actual PermissionPrompt UI is rendered by FloatingPermissionPrompt
  // which manages its own subscription. This subscription only updates the
  // ref (for loadPendingInteractionState compat) and the boolean indicator
  // for NavRail. It does NOT call setPendingPermission to avoid re-rendering
  // the entire Layout tree.
  useEffect(() => {
    if (!accessToken) {
      pendingPermissionRef.current = null;
      setPendingPermissionIndicator(false);
      return;
    }
    return subscribeSessionPendingPermission((_sessionId, permission) => {
      pendingPermissionRef.current = permission;
      setPendingPermissionIndicator(permission !== null);
    });
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !currentChatSessionId) {
      // Don't clear pendingPermission here — it may come from another
      // session and should stay visible on non-chat pages.
      applyPendingQuestion(null);
      return;
    }

    applyPendingQuestion(null);

    const controller = new AbortController();
    void loadPendingInteractionState(currentChatSessionId, { signal: controller.signal }).catch(
      () => {
        if (controller.signal.aborted) {
          return;
        }
      },
    );

    return () => controller.abort();
  }, [accessToken, applyPendingQuestion, currentChatSessionId, loadPendingInteractionState]);

  useEffect(() => {
    if (!currentChatSessionId) {
      return;
    }

    return subscribeCurrentSessionRefresh((sessionId) => {
      if (sessionId !== currentChatSessionId) {
        return;
      }
      void loadPendingInteractionState(sessionId, {
        preserveQuestionAnswersForSameRequest: true,
      }).catch(() => {
        return;
      });
    });
  }, [currentChatSessionId, loadPendingInteractionState]);

  const togglePendingQuestionAnswer = useCallback(
    (questionIndex: number, optionLabel: string, multiple: boolean) => {
      setPendingQuestionAnswers((previous) => {
        const next = previous.map((answers) => [...answers]);
        while (next.length <= questionIndex) {
          next.push([]);
        }
        const currentAnswers = next[questionIndex] ?? [];
        if (multiple) {
          next[questionIndex] = currentAnswers.includes(optionLabel)
            ? currentAnswers.filter((answer) => answer !== optionLabel)
            : [...currentAnswers, optionLabel];
        } else {
          next[questionIndex] = currentAnswers.includes(optionLabel) ? [] : [optionLabel];
        }
        return next;
      });
    },
    [],
  );

  const replyPendingQuestion = useCallback(
    async (status: 'answered' | 'dismissed') => {
      if (!accessToken || !pendingQuestion) {
        applyPendingQuestion(null);
        return;
      }

      const payload =
        status === 'answered'
          ? { answers: pendingQuestionAnswers, requestId: pendingQuestion.requestId, status }
          : { requestId: pendingQuestion.requestId, status };
      const currentSessionId = currentChatSessionId;
      const targetSessionId = pendingQuestion.sessionId;

      try {
        setPendingQuestionReplyStatus(status);
        setPendingQuestionReplyError(null);
        await createQuestionsClient(gatewayUrl).reply(
          accessToken,
          pendingQuestion.sessionId,
          payload,
        );
        applyPendingQuestion(null);
        if (currentSessionId) {
          requestCurrentSessionRefresh(currentSessionId);
        }
        if (targetSessionId !== currentSessionId) {
          requestCurrentSessionRefresh(targetSessionId);
        }
        requestSessionListRefresh();
      } catch (error) {
        const resolved = resolveQuestionReplyError(error);
        if (resolved.dismissPrompt) {
          applyPendingQuestion(null);
          toast(resolved.toastMessage ?? resolved.inlineMessage, 'warning', 4200);
          if (currentSessionId) {
            requestCurrentSessionRefresh(currentSessionId);
          }
          if (targetSessionId !== currentSessionId) {
            requestCurrentSessionRefresh(targetSessionId);
          }
          requestSessionListRefresh();
        } else {
          setPendingQuestionReplyError(resolved.inlineMessage);
        }
      } finally {
        setPendingQuestionReplyStatus(null);
      }
    },
    [
      accessToken,
      applyPendingQuestion,
      currentChatSessionId,
      gatewayUrl,
      pendingQuestion,
      pendingQuestionAnswers,
    ],
  );

  useEffect(() => {
    if (!currentChatSessionId) {
      return;
    }

    return subscribeSessionPendingQuestion((sessionId, question) => {
      if (sessionId === currentChatSessionId) {
        applyPendingQuestion(question, { preserveAnswersForSameRequest: true });
      }
    });
  }, [applyPendingQuestion, currentChatSessionId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.metaKey || e.ctrlKey;
      if (ctrl && e.key === 'k') {
        e.preventDefault();
        setIsPaletteOpen((o) => !o);
        return;
      }
      if (ctrl && e.key === 'b') {
        e.preventDefault();
        toggleLeftSidebar();
        return;
      }
      if (ctrl && e.key === 'n') {
        e.preventDefault();
        navigateToHome();
        preloadRoute('/chat');
        void navigate('/chat');
        return;
      }
      if (ctrl && e.key === ',') {
        e.preventDefault();
        preloadRoute('/settings');
        void navigate('/settings');
        return;
      }
      if (ctrl && e.key === 'd') {
        e.preventDefault();
        alert('复制会话功能开发中');
        return;
      }
      if (ctrl && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const text = document.querySelector('.outlet-content-wrap')?.textContent ?? '';
        void navigator.clipboard.writeText(text);
        return;
      }
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftSidebar, navigateToHome, navigate, preloadRoute]);

  const paletteCommands = useMemo<CommandItem[]>(() => {
    const commandItems = paletteDescriptors.flatMap((command) => {
      const action = command.action;

      switch (action.kind) {
        case 'navigate':
          return [
            {
              id: command.id,
              label: command.label,
              description: command.description,
              shortcut: command.shortcut,
              onExecute: () => {
                preloadRoute(action.to);
                void navigate(action.to);
              },
            },
          ];
        case 'toggle_theme':
          if (!onToggleTheme) return [];
          return [
            {
              id: command.id,
              label: command.label,
              description: theme === 'dark' ? '切换到亮色' : '切换到暗色',
              shortcut: command.shortcut,
              onExecute: onToggleTheme,
            },
          ];
        default:
          return [];
      }
    });

    const searchItems = paletteSearchResults.map(
      (result) =>
        ({
          id: `session-search:${result.messageId}`,
          label: `会话 · ${result.title?.trim() || result.sessionId}`,
          description: result.snippet.replaceAll('<mark>', '').replaceAll('</mark>', ''),
          onExecute: () => {
            preloadRoute('/chat');
            void navigate(`/chat/${result.sessionId}`);
          },
          shortcut: '结果',
        }) satisfies CommandItem,
    );

    return [...searchItems, ...commandItems];
  }, [navigate, onToggleTheme, paletteDescriptors, paletteSearchResults, preloadRoute, theme]);

  useEffect(() => {
    if (!isPaletteOpen || !accessToken || paletteQuery.trim().length < 2) {
      setPaletteSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      void createSessionsClient(gatewayUrl)
        .search(accessToken, paletteQuery.trim(), {
          limit: 6,
          signal: controller.signal,
        })
        .then((results) => {
          if (!controller.signal.aborted) {
            setPaletteSearchResults(results);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setPaletteSearchResults([]);
          }
        });
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [accessToken, gatewayUrl, isPaletteOpen, paletteQuery]);

  // shouldOverlaySessionSidebar / sessionSidebarWidth 已随 SessionSidebar 一起
  // 迁出至 ChatPage 内部计算;Layout 不再渲染会话列表。

  return (
    <>
      <style>{`@keyframes toast-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
@keyframes permissionSlideIn { from { opacity:0; transform:translateY(-12px); } to { opacity:1; transform:translateY(0); } }
@keyframes permissionPulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.6; transform:scale(1.35); } }`}</style>
      <CommandPalette
        commands={paletteCommands}
        emptyLabel={
          paletteQuery.trim().length >= 2 ? '没有匹配的命令或会话' : '输入至少 2 个字符开始搜索'
        }
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onQueryChange={setPaletteQuery}
        placeholder="搜索命令、会话内容…"
        query={paletteQuery}
      />
      <FloatingPermissionPrompt onPendingChange={setPendingPermissionIndicator} />
      {pendingQuestion && !isChatRoute && (
        <QuestionPromptCard
          answers={pendingQuestionAnswers}
          errorMessage={pendingQuestionReplyError ?? undefined}
          pendingAction={pendingQuestionReplyStatus}
          request={pendingQuestion}
          onDismiss={() => {
            void replyPendingQuestion('dismissed');
          }}
          onSubmit={() => {
            void replyPendingQuestion('answered');
          }}
          onToggleOption={togglePendingQuestionAnswer}
        />
      )}
      <PermissionConfirmDialog
        open={pendingConfirmDialog !== null}
        skillName={pendingConfirmDialog?.skillName ?? ''}
        permissions={pendingConfirmDialog?.permissions ?? []}
        trustLevel={pendingConfirmDialog?.trustLevel ?? 'standard'}
        onConfirm={() => {
          setPendingConfirmDialog(null);
        }}
        onCancel={() => {
          setPendingConfirmDialog(null);
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          overflow: 'hidden',
          background: 'var(--bg-base)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flex: 1,
            overflow: 'hidden',
            padding: 'var(--layout-padding, 4px 4px 6px)',
            position: 'relative',
          }}
        >
          <AppSidebar
            accessToken={accessToken}
            gatewayUrl={gatewayUrl}
            theme={theme}
            onToggleTheme={onToggleTheme}
            onLogout={() => {
              clearAuth();
              void navigate('/');
            }}
            pendingPermissionIndicator={pendingPermissionIndicator}
          />

          <div
            style={{
              display: 'flex',
              flex: 1,
              minWidth: 0,
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', minWidth: 0 }}
            >
              <div
                className="outlet-content-wrap"
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  display: 'flex',
                  minWidth: 0,
                  position: 'relative',
                }}
              >
                <CachedRouteOutlet />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
