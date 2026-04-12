import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import NavRail from './layout/NavRail.js';
import WorkspacePickerModal from './WorkspacePickerModal.js';
import { SessionSidebar } from './layout/SessionSidebar.js';
import { CachedRouteOutlet } from './CachedRouteOutlet.js';
import QuestionPromptCard from './QuestionPromptCard.js';
import { useUIStateStore } from '../stores/uiState.js';
import { useNavigate, useLocation } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { CommandPalette, PermissionPrompt, PermissionConfirmDialog } from '@openAwork/shared-ui';
import type { CommandItem, PermissionDecision, PermissionItem } from '@openAwork/shared-ui';
import type { FileTreeNode } from './WorkspacePickerModal.js';
import { useCommandRegistry } from '../hooks/useCommandRegistry.js';
import { preloadRouteModuleByPath } from '../routes/preloadable-route-modules.js';
import {
  createNotificationsClient,
  createPermissionsClient,
  createQuestionsClient,
  createSessionsClient,
} from '@openAwork/web-client';
import type {
  NotificationPreferenceEventType,
  NotificationPreferenceRecord,
  NotificationRecord,
  PendingQuestionRequest,
  SessionSearchResult,
} from '@openAwork/web-client';
import {
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
  subscribeCurrentSessionRefresh,
  subscribeSessionPendingPermission,
  subscribeSessionPendingQuestion,
} from '../utils/session-list-events.js';
import { subscribeNotificationPreferenceRefresh } from '../utils/notification-preference-events.js';
import { toast } from './ToastNotification.js';
import { getRecoveryPendingInteractions } from '../pages/chat-page/recovery-read-model.js';

type NotificationPreferenceMap = Record<NotificationPreferenceEventType, boolean>;

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceMap = {
  permission_asked: false,
  question_asked: false,
  task_update: false,
};

function toNotificationPreferenceMap(
  records: NotificationPreferenceRecord[],
): NotificationPreferenceMap {
  const nextPreferences: NotificationPreferenceMap = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  records.forEach((record) => {
    nextPreferences[record.eventType] = record.enabled;
  });
  return nextPreferences;
}

function isBrowserNotificationEnabled(
  eventType: string,
  preferences: NotificationPreferenceMap,
): boolean {
  if (
    eventType === 'permission_asked' ||
    eventType === 'question_asked' ||
    eventType === 'task_update'
  ) {
    return preferences[eventType];
  }

  return true;
}

interface PendingPermissionPromptState {
  requestId: string;
  targetSessionId: string;
  toolName: string;
  scope: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewAction?: string;
}

type PendingQuestionReplyStatus = 'answered' | 'dismissed';

function toPendingPermissionPromptState(
  request: {
    requestId: string;
    sessionId: string;
    toolName: string;
    scope: string;
    reason: string;
    riskLevel: 'low' | 'medium' | 'high';
    previewAction?: string;
  } | null,
): PendingPermissionPromptState | null {
  if (!request) {
    return null;
  }

  return {
    requestId: request.requestId,
    targetSessionId: request.sessionId,
    toolName: request.toolName,
    scope: request.scope,
    reason: request.reason,
    riskLevel: request.riskLevel,
    previewAction: request.previewAction,
  };
}

function resolvePermissionReplyError(error: unknown): {
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
    if (httpError.status === 409 && httpError.data?.error === 'Permission request expired') {
      return {
        dismissPrompt: true,
        inlineMessage: '该权限请求已过期，正在重新同步。',
        toastMessage: '权限请求已过期，已重新同步状态。',
      };
    }

    if (
      httpError.status === 409 &&
      httpError.data?.error === 'Permission request already resolved'
    ) {
      return {
        dismissPrompt: true,
        inlineMessage: '该权限请求已被处理，正在重新同步。',
        toastMessage: '权限请求已被处理，已重新同步状态。',
      };
    }

    if (httpError.status === 404) {
      return {
        dismissPrompt: true,
        inlineMessage: '权限请求已不存在，正在重新同步。',
        toastMessage: '权限请求已不存在，已重新同步状态。',
      };
    }
  }

  return {
    dismissPrompt: false,
    inlineMessage: error instanceof Error ? error.message : '权限处理失败，请重试。',
  };
}

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
  onOpenFile?: (path: string) => void;
}

export default function Layout({ theme = 'dark', onToggleTheme, onOpenFile }: LayoutProps = {}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);

  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 960 : false,
  );

  const fetchWorkspaceRoots = useCallback(async (): Promise<string[]> => {
    const res = await fetch(`${gatewayUrl}/workspace/root`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('fetchRootPath failed');
    const data = (await res.json()) as { root?: string; roots?: string[] };
    const roots = Array.isArray(data.roots)
      ? data.roots.filter((root) => typeof root === 'string' && root.length > 0)
      : typeof data.root === 'string' && data.root.length > 0
        ? [data.root]
        : [];

    if (roots.length === 0) {
      throw new Error('fetchRootPath failed');
    }

    return roots;
  }, [accessToken, gatewayUrl]);

  const fetchRootPath = useCallback(async (): Promise<string> => {
    const roots = await fetchWorkspaceRoots();
    const root = roots[0];
    if (!root) {
      throw new Error('fetchRootPath failed');
    }

    return root;
  }, [fetchWorkspaceRoots]);

  const fetchTree = useCallback(
    async (path: string, depth = 1) => {
      const res = await fetch(
        `${gatewayUrl}/workspace/tree?path=${encodeURIComponent(path)}&depth=${depth}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new Error('fetchTree failed');
      const data = await res.json();
      return (data?.nodes ?? data) as FileTreeNode[];
    },
    [accessToken, gatewayUrl],
  );

  const validatePath = useCallback(
    async (path: string): Promise<{ valid: boolean; error?: string; path?: string }> => {
      const res = await fetch(`${gatewayUrl}/workspace/validate?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        return { valid: false, error: `Validation request failed: ${res.status}` };
      }

      return res.json();
    },
    [accessToken, gatewayUrl],
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
  const selectedWorkspacePath = uiState.selectedWorkspacePath;
  const addSavedWorkspacePath = uiState.addSavedWorkspacePath;
  const setSelectedWorkspacePath = uiState.setSelectedWorkspacePath;
  const setFileTreeRootPath = uiState.setFileTreeRootPath;
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferenceMap>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const paletteDescriptors = useCommandRegistry('palette');

  const [pendingPermission, setPendingPermission] = useState<PendingPermissionPromptState | null>(
    null,
  );
  const [permissionReplyPendingDecision, setPermissionReplyPendingDecision] =
    useState<PermissionDecision | null>(null);
  const [permissionReplyError, setPermissionReplyError] = useState<string | null>(null);
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
  const seenNotificationIdsRef = useMemo(() => new Set<string>(), []);
  const notificationPreferencesRef = useRef<NotificationPreferenceMap>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );

  useEffect(() => {
    notificationPreferencesRef.current = notificationPreferences;
  }, [notificationPreferences]);

  const updatePendingPermission = useCallback((next: PendingPermissionPromptState | null) => {
    setPendingPermission(next);
    setPermissionReplyPendingDecision(null);
    setPermissionReplyError(null);
  }, []);

  const loadNotificationPreferences = useCallback(async (): Promise<NotificationPreferenceMap> => {
    if (!accessToken) {
      setNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }

    try {
      const nextPreferences = toNotificationPreferenceMap(
        await createNotificationsClient(gatewayUrl).listPreferences(accessToken, {
          channel: 'web',
        }),
      );
      setNotificationPreferences(nextPreferences);
      return nextPreferences;
    } catch {
      return notificationPreferencesRef.current;
    }
  }, [accessToken, gatewayUrl]);

  const loadNotifications = useCallback(
    async (options?: { preferences?: NotificationPreferenceMap }) => {
      if (!accessToken) {
        setNotifications([]);
        return;
      }
      const effectivePreferences = options?.preferences ?? notificationPreferencesRef.current;
      const nextNotifications = await createNotificationsClient(gatewayUrl).list(accessToken, {
        limit: 12,
        status: 'unread',
      });
      setNotifications(nextNotifications);

      if (
        typeof window !== 'undefined' &&
        document.visibilityState === 'hidden' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        nextNotifications.forEach((item) => {
          if (seenNotificationIdsRef.has(item.id)) {
            return;
          }
          seenNotificationIdsRef.add(item.id);
          if (!isBrowserNotificationEnabled(item.eventType, effectivePreferences)) {
            return;
          }
          new Notification(item.title, { body: item.body, tag: item.id });
        });
      } else {
        nextNotifications.forEach((item) => {
          seenNotificationIdsRef.add(item.id);
        });
      }
    },
    [accessToken, gatewayUrl, seenNotificationIdsRef],
  );

  const handleOpenNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!accessToken) {
        return;
      }

      await createNotificationsClient(gatewayUrl).markRead(accessToken, notification.id);
      setNotifications((previous) => previous.filter((item) => item.id !== notification.id));
      setNotificationsOpen(false);
      if (notification.sessionId) {
        preloadRoute('/chat');
        void navigate(`/chat/${notification.sessionId}`);
      }
    },
    [accessToken, gatewayUrl, navigate, preloadRoute],
  );

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

      const recovery = await createSessionsClient(gatewayUrl).getRecovery(
        accessToken,
        sessionId,
        options,
      );
      const pendingInteractions = getRecoveryPendingInteractions(recovery);
      updatePendingPermission(
        toPendingPermissionPromptState(pendingInteractions.pendingPermission),
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

  useEffect(() => {
    if (!accessToken || !currentChatSessionId) {
      updatePendingPermission(null);
      return;
    }

    updatePendingPermission(null);

    return subscribeSessionPendingPermission((sessionId, permission) => {
      if (sessionId === currentChatSessionId) {
        updatePendingPermission(permission);
      }
    });
  }, [accessToken, currentChatSessionId, updatePendingPermission]);

  useEffect(() => {
    if (!currentChatSessionId) {
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
  }, [applyPendingQuestion, currentChatSessionId, loadPendingInteractionState]);

  useEffect(() => {
    if (!accessToken) {
      setNotifications([]);
      setNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    void (async () => {
      const preferences = await loadNotificationPreferences();
      if (cancelled) {
        return;
      }
      await loadNotifications({ preferences });
      if (cancelled) {
        return;
      }
      intervalId = window.setInterval(() => {
        void loadNotifications().catch(() => undefined);
      }, 15_000);
    })().catch(() => undefined);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [accessToken, loadNotificationPreferences, loadNotifications]);

  useEffect(() => {
    return subscribeNotificationPreferenceRefresh(() => {
      void loadNotificationPreferences().catch(() => undefined);
    });
  }, [loadNotificationPreferences]);

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

  const shouldOverlaySessionSidebar = isChatRoute && isNarrowViewport;
  const sessionSidebarWidth = shouldOverlaySessionSidebar
    ? 'min(86vw, var(--sidebar-width, 260px))'
    : 'var(--sidebar-width, 260px)';

  const handleSelectWorkspace = useCallback(
    async (path: string) => {
      addSavedWorkspacePath(path);
      setSelectedWorkspacePath(path);
      setFileTreeRootPath(path);
      setShowWorkspacePicker(false);
    },
    [addSavedWorkspacePath, setFileTreeRootPath, setSelectedWorkspacePath],
  );

  const handlePermissionDecision = useCallback(
    async (requestId: string, decision: PermissionDecision) => {
      if (!accessToken || !currentChatSessionId || !pendingPermission) {
        updatePendingPermission(null);
        return;
      }

      setPermissionReplyPendingDecision(decision);
      setPermissionReplyError(null);

      try {
        await createPermissionsClient(gatewayUrl).reply(
          accessToken,
          pendingPermission.targetSessionId,
          {
            requestId,
            decision,
          },
        );
        updatePendingPermission(null);
        // Delay to give the backend time to start the resume runtime thread
        window.setTimeout(() => {
          requestCurrentSessionRefresh(currentChatSessionId);
          requestSessionListRefresh();
        }, 500);
      } catch (error) {
        const resolved = resolvePermissionReplyError(error);
        if (resolved.dismissPrompt) {
          updatePendingPermission(null);
          toast(resolved.toastMessage ?? resolved.inlineMessage, 'warning', 4200);
          requestCurrentSessionRefresh(currentChatSessionId);
          requestSessionListRefresh();
        } else {
          setPermissionReplyError(resolved.inlineMessage);
        }
      } finally {
        setPermissionReplyPendingDecision(null);
      }
    },
    [accessToken, currentChatSessionId, gatewayUrl, pendingPermission, updatePendingPermission],
  );

  return (
    <>
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
      {pendingPermission && (
        <PermissionPrompt
          requestId={pendingPermission.requestId}
          toolName={pendingPermission.toolName}
          scope={pendingPermission.scope}
          reason={pendingPermission.reason}
          riskLevel={pendingPermission.riskLevel}
          previewAction={pendingPermission.previewAction}
          pendingDecision={permissionReplyPendingDecision}
          errorMessage={permissionReplyError ?? undefined}
          onDecide={(requestId: string, decision: PermissionDecision) => {
            void handlePermissionDecision(requestId, decision);
          }}
          style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 500 }}
        />
      )}
      {pendingQuestion && (
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
      <WorkspacePickerModal
        isOpen={showWorkspacePicker}
        onClose={() => setShowWorkspacePicker(false)}
        onSelect={handleSelectWorkspace}
        fetchRootPath={fetchRootPath}
        fetchWorkspaceRoots={fetchWorkspaceRoots}
        fetchTree={fetchTree}
        validatePath={validatePath}
        initialPath={uiState.fileTreeRootPath ?? selectedWorkspacePath ?? undefined}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          overflow: 'hidden',
          background: 'var(--bg)',
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
          <div
            style={{
              display: 'flex',
              flex: 1,
              overflow: 'hidden',
              borderRadius: 12,
              background: 'var(--bg-glass)',
              border: '1px solid var(--bg-glass-border)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: 'var(--shadow-sm), var(--shadow-md), var(--shadow-lg)',
            }}
          >
            <NavRail clearAuth={clearAuth} />

            <div
              aria-hidden={!leftSidebarOpen || !isChatRoute}
              style={{
                width: shouldOverlaySessionSidebar
                  ? sessionSidebarWidth
                  : isChatRoute && leftSidebarOpen
                    ? sessionSidebarWidth
                    : 0,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                height: '100%',
                borderRight:
                  isChatRoute && leftSidebarOpen ? '1px solid var(--border-subtle)' : 'none',
                transition: shouldOverlaySessionSidebar
                  ? 'transform 200ms ease, opacity 200ms ease'
                  : 'width 200ms ease',
                pointerEvents: isChatRoute && leftSidebarOpen ? undefined : 'none',
                position: shouldOverlaySessionSidebar ? 'absolute' : 'relative',
                left: shouldOverlaySessionSidebar ? 0 : undefined,
                top: shouldOverlaySessionSidebar ? 0 : undefined,
                bottom: shouldOverlaySessionSidebar ? 0 : undefined,
                zIndex: shouldOverlaySessionSidebar ? 35 : undefined,
                transform: shouldOverlaySessionSidebar
                  ? leftSidebarOpen
                    ? 'translateX(0)'
                    : 'translateX(-100%)'
                  : undefined,
                opacity: shouldOverlaySessionSidebar ? (leftSidebarOpen ? 1 : 0) : 1,
                boxShadow:
                  shouldOverlaySessionSidebar && leftSidebarOpen ? 'var(--shadow-lg)' : 'none',
                background: shouldOverlaySessionSidebar ? 'var(--surface)' : undefined,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  width: sessionSidebarWidth,
                  maxWidth: '100%',
                }}
              >
                <SessionSidebar
                  onOpenFile={onOpenFile}
                  fetchRootPath={fetchRootPath}
                  fetchTree={fetchTree}
                  onOpenWorkspacePicker={() => setShowWorkspacePicker(true)}
                />
              </div>
            </div>

            {shouldOverlaySessionSidebar && leftSidebarOpen && (
              <button
                type="button"
                aria-label="关闭侧栏遮罩"
                onClick={() => setLeftSidebarOpen(false)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 30,
                  background: 'oklch(0 0 0 / 0.42)',
                  backdropFilter: 'blur(1px)',
                }}
              />
            )}

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
                data-testid="layout-topbar"
                style={{
                  display: 'flex',
                  height: 44,
                  flexShrink: 0,
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 12px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--header-bg)',
                }}
              >
                {isChatRoute && !leftSidebarOpen && (
                  <button
                    type="button"
                    title="展开面板"
                    onClick={() => setLeftSidebarOpen(true)}
                    className="icon-btn"
                    style={{
                      display: 'flex',
                      width: 28,
                      height: 28,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 7,
                      color: 'var(--text-3)',
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                )}
                <span
                  style={{
                    flex: 1,
                    userSelect: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <svg
                    aria-hidden="true"
                    width={18}
                    height={18}
                    viewBox="0 0 32 32"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect width="32" height="32" rx="7" fill="var(--accent)" />
                    <path
                      d="M 16,3 C 26,3 29,12 16,16"
                      stroke="var(--accent-text)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      fill="none"
                      opacity="0.92"
                      transform="rotate(0, 16, 16)"
                    />
                    <path
                      d="M 16,3 C 26,3 29,12 16,16"
                      stroke="var(--accent-text)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      fill="none"
                      opacity="0.92"
                      transform="rotate(120, 16, 16)"
                    />
                    <path
                      d="M 16,3 C 26,3 29,12 16,16"
                      stroke="var(--accent-text)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      fill="none"
                      opacity="0.92"
                      transform="rotate(240, 16, 16)"
                    />
                    <circle cx="16" cy="16" r="2.5" fill="var(--accent-text)" />
                  </svg>
                  OpenAWork
                </span>

                {accessToken && (
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationsOpen((previous) => !previous);
                        void loadNotifications().catch(() => undefined);
                      }}
                      title="通知中心"
                      className="toolbar-btn"
                      style={{
                        display: 'flex',
                        width: 30,
                        height: 30,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 7,
                        color: 'var(--text-3)',
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--surface)',
                        transition: 'color 150ms ease, background 150ms ease',
                        cursor: 'pointer',
                        position: 'relative',
                      }}
                    >
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
                        <path d="M9 17a3 3 0 0 0 6 0" />
                      </svg>
                      {notifications.length > 0 ? (
                        <span
                          style={{
                            position: 'absolute',
                            top: -4,
                            right: -4,
                            minWidth: 16,
                            height: 16,
                            padding: '0 4px',
                            borderRadius: 999,
                            background: 'var(--danger)',
                            color: 'white',
                            fontSize: 10,
                            fontWeight: 700,
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          {notifications.length > 9 ? '9+' : notifications.length}
                        </span>
                      ) : null}
                    </button>
                    {notificationsOpen ? (
                      <div
                        style={{
                          position: 'absolute',
                          top: 36,
                          right: 0,
                          width: 320,
                          maxHeight: 420,
                          overflow: 'auto',
                          borderRadius: 14,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          boxShadow: 'var(--shadow-lg)',
                          padding: 10,
                          zIndex: 40,
                          display: 'grid',
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                            通知中心
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                            {notifications.length} 条未读
                          </span>
                        </div>
                        {notifications.length === 0 ? (
                          <div
                            style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 8px' }}
                          >
                            暂无未读通知
                          </div>
                        ) : (
                          notifications.map((notification) => (
                            <button
                              key={notification.id}
                              type="button"
                              onClick={() => void handleOpenNotification(notification)}
                              style={{
                                textAlign: 'left',
                                display: 'grid',
                                gap: 4,
                                padding: '10px 12px',
                                borderRadius: 12,
                                border: '1px solid var(--border-subtle)',
                                background: 'var(--bg-2)',
                                cursor: 'pointer',
                              }}
                            >
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                                {notification.title}
                              </span>
                              <span
                                style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}
                              >
                                {notification.body}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                                {new Date(notification.createdAt).toLocaleString('zh-CN', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                )}

                {onToggleTheme && (
                  <button
                    type="button"
                    onClick={onToggleTheme}
                    title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
                    className="toolbar-btn"
                    style={{
                      display: 'flex',
                      width: 30,
                      height: 30,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 7,
                      color: 'var(--text-3)',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--surface)',
                      transition: 'color 150ms ease, background 150ms ease',
                      cursor: 'pointer',
                    }}
                  >
                    {theme === 'dark' ? (
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 15 15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      >
                        <circle cx="7.5" cy="7.5" r="2.5" />
                        <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.9 2.9l1.1 1.1M11 11l1.1 1.1M2.9 12.1l1.1-1.1M11 4l1.1-1.1" />
                      </svg>
                    ) : (
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 15 15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12.5 9A5.5 5.5 0 0 1 6 2.5a5.5 5.5 0 1 0 6.5 6.5z" />
                      </svg>
                    )}
                  </button>
                )}
              </div>

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
      </div>
    </>
  );
}
