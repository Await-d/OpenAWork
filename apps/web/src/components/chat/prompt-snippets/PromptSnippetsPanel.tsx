/**
 * 快捷提示词面板 — 独立组件。
 *
 * 功能：
 * - 分组管理（添加、编辑、删除）
 * - 提示词 CRUD（添加、编辑、删除）
 * - 复制提示词到剪贴板
 * - 注入提示词到输入框光标位置
 *
 * 使用方式：
 *   <PromptSnippetsPanel
 *     open={open}
 *     anchorRef={buttonRef}
 *     gatewayUrl={gatewayUrl}
 *     token={token}
 *     onInject={(text) => insertAtCursor(text)}
 *     onClose={() => setOpen(false)}
 *   />
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createPromptSnippetsClient,
  type PromptSnippet,
  type PromptSnippetGroup,
} from '@openAwork/web-client';
import {
  getUserVisibleErrorMessage,
  isAbortLikeError,
} from '../../../utils/errors/user-visible-error.js';

function iconStroke(color = 'currentColor') {
  return {
    fill: 'none',
    stroke: color,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path {...iconStroke()} strokeWidth="1.9" d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path {...iconStroke()} strokeWidth="2" d="m6 6 12 12" />
      <path {...iconStroke()} strokeWidth="2" d="m18 6-12 12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path {...iconStroke()} strokeWidth="2" d="M12 5v14" />
      <path {...iconStroke()} strokeWidth="2" d="M5 12h14" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <rect {...iconStroke()} strokeWidth="1.8" x="9" y="9" width="10" height="10" rx="2" />
      <path
        {...iconStroke()}
        strokeWidth="1.8"
        d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path {...iconStroke()} strokeWidth="2.2" d="m5 12 4.2 4.2L19 6.5" />
    </svg>
  );
}

function InjectIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path {...iconStroke()} strokeWidth="2" d="M5 12h10" />
      <path {...iconStroke()} strokeWidth="2" d="m11 6 6 6-6 6" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path
        {...iconStroke()}
        strokeWidth="1.9"
        d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path {...iconStroke()} strokeWidth="1.9" d="M3 6h18" />
      <path {...iconStroke()} strokeWidth="1.9" d="M8 6V4h8v2" />
      <path {...iconStroke()} strokeWidth="1.9" d="m19 6-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path {...iconStroke()} strokeWidth="1.9" d="M10 11v6M14 11v6" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 12,
        height: 12,
        borderRadius: 999,
        border: '1.8px solid color-mix(in oklch, var(--accent) 26%, transparent)',
        borderTopColor: 'var(--accent)',
        display: 'inline-block',
        animation: 'prompt-snippets-spin 0.8s linear infinite',
      }}
    />
  );
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface PromptSnippetsPanelProps {
  open: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  gatewayUrl: string;
  token: string | null;
  onInject: (text: string) => void;
  onClose: () => void;
}

// ─── Sub-views ──────────────────────────────────────────────────────────────

type PanelView = 'list' | 'add-group' | 'edit-group' | 'add-snippet' | 'edit-snippet';
type PanelActionKind =
  | 'create-group'
  | 'update-group'
  | 'delete-group'
  | 'create-snippet'
  | 'update-snippet'
  | 'delete-snippet'
  | 'copy-snippet';

interface PanelActionState {
  readonly kind: PanelActionKind;
  readonly targetId?: string;
}

export function PromptSnippetsPanel({
  open,
  anchorRef,
  gatewayUrl,
  token,
  onInject,
  onClose,
}: PromptSnippetsPanelProps) {
  const [groups, setGroups] = useState<PromptSnippetGroup[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [view, setView] = useState<PanelView>('list');
  const [editingGroup, setEditingGroup] = useState<PromptSnippetGroup | null>(null);
  const [editingSnippet, setEditingSnippet] = useState<PromptSnippet | null>(null);
  const [pendingAction, setPendingAction] = useState<PanelActionState | null>(null);
  const [formName, setFormName] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ bottom: number; left: number } | null>(
    null,
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const fetchAbortControllerRef = useRef<AbortController | null>(null);
  const fetchRequestIdRef = useRef(0);
  const copiedResetTimerRef = useRef<number | null>(null);

  const client = useMemo(() => createPromptSnippetsClient(gatewayUrl), [gatewayUrl]);
  const hasAuth = typeof token === 'string' && token.trim().length > 0;
  const hasPendingAction = pendingAction !== null;

  // ─── Popover position (same pattern as CompanionStage) ──────────────────

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setPopoverPosition(null);
      return;
    }
    const update = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportW = globalThis.window?.innerWidth ?? rect.right;
      const viewportH = globalThis.window?.innerHeight ?? rect.bottom;
      const POPOVER_WIDTH = 480;
      const preferredLeft = rect.left;
      const maxLeft = viewportW - POPOVER_WIDTH - 8;
      const left = Math.max(8, Math.min(preferredLeft, maxLeft));
      setPopoverPosition({
        bottom: Math.max(8, viewportH - rect.top + 6),
        left,
      });
    };
    update();
    if (typeof globalThis.window !== 'undefined') {
      globalThis.window.addEventListener('resize', update);
      globalThis.window.addEventListener('scroll', update, true);
      return () => {
        globalThis.window.removeEventListener('resize', update);
        globalThis.window.removeEventListener('scroll', update, true);
      };
    }
    return undefined;
  }, [open, anchorRef]);

  // ─── Data fetching ──────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    fetchRequestIdRef.current += 1;
    const requestId = fetchRequestIdRef.current;
    fetchAbortControllerRef.current?.abort();

    if (!hasAuth || !token) {
      fetchAbortControllerRef.current = null;
      setGroups([]);
      setSnippets([]);
      setActiveGroupId(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    fetchAbortControllerRef.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const [g, s] = await Promise.all([
        client.listGroups(token, { signal: controller.signal }),
        client.listSnippets(token, { signal: controller.signal }),
      ]);
      if (fetchRequestIdRef.current !== requestId || controller.signal.aborted) {
        return;
      }
      setGroups(g);
      setSnippets(s);
      setActiveGroupId((current) => {
        const currentGroup = current ? g.find((group) => group.id === current) : undefined;
        if (currentGroup) {
          return currentGroup.id;
        }
        const firstGroup = g[0];
        return firstGroup ? firstGroup.id : null;
      });
    } catch (error) {
      if (
        fetchRequestIdRef.current !== requestId ||
        controller.signal.aborted ||
        isAbortLikeError(error)
      ) {
        return;
      }
      setLoadError(getUserVisibleErrorMessage(error, '读取快捷提示词失败，请稍后重试。'));
    } finally {
      if (fetchAbortControllerRef.current === controller) {
        fetchAbortControllerRef.current = null;
      }
      if (fetchRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [client, hasAuth, token]);

  useEffect(() => {
    if (!open) return;
    setActionError(null);
    void fetchData();
  }, [open, fetchData]);

  useEffect(() => {
    if (open) return;
    fetchRequestIdRef.current += 1;
    fetchAbortControllerRef.current?.abort();
    fetchAbortControllerRef.current = null;
    setLoading(false);
  }, [open]);

  useEffect(() => {
    return () => {
      fetchAbortControllerRef.current?.abort();
      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
    };
  }, []);

  // ─── Click outside to close ─────────────────────────────────────────────
  // Uses a transparent fixed scrim button (same pattern as CompanionStage).

  // ─── Escape to close ────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleCreateGroup = async () => {
    if (!hasAuth || !token || !formName.trim()) return;
    setActionError(null);
    setPendingAction({ kind: 'create-group' });
    try {
      await client.createGroup(token, { name: formName.trim() });
      setFormName('');
      setView('list');
      await fetchData();
    } catch (error) {
      setActionError(getUserVisibleErrorMessage(error, '创建提示词分组失败，请稍后重试。'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleUpdateGroup = async () => {
    if (!hasAuth || !token || !editingGroup || !formName.trim()) return;
    setActionError(null);
    setPendingAction({ kind: 'update-group', targetId: editingGroup.id });
    try {
      await client.updateGroup(token, editingGroup.id, { name: formName.trim() });
      setFormName('');
      setEditingGroup(null);
      setView('list');
      await fetchData();
    } catch (error) {
      setActionError(getUserVisibleErrorMessage(error, '更新提示词分组失败，请稍后重试。'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!hasAuth || !token) return;
    setActionError(null);
    setPendingAction({ kind: 'delete-group', targetId: groupId });
    try {
      await client.deleteGroup(token, groupId);
      if (activeGroupId === groupId) setActiveGroupId(null);
      await fetchData();
    } catch (error) {
      setActionError(getUserVisibleErrorMessage(error, '删除提示词分组失败，请稍后重试。'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreateSnippet = async () => {
    const activeGroup = activeGroupId
      ? groups.find((group) => group.id === activeGroupId)
      : undefined;
    if (!hasAuth || !token || !formTitle.trim() || !formContent.trim() || !activeGroup) return;
    setActionError(null);
    setPendingAction({ kind: 'create-snippet', targetId: activeGroup.id });
    try {
      await client.createSnippet(token, {
        groupId: activeGroup.id,
        title: formTitle.trim(),
        content: formContent.trim(),
      });
      setFormTitle('');
      setFormContent('');
      setView('list');
      await fetchData();
    } catch (error) {
      setActionError(getUserVisibleErrorMessage(error, '创建提示词失败，请稍后重试。'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleUpdateSnippet = async () => {
    if (!hasAuth || !token || !editingSnippet || !formTitle.trim() || !formContent.trim()) return;
    setActionError(null);
    setPendingAction({ kind: 'update-snippet', targetId: editingSnippet.id });
    try {
      await client.updateSnippet(token, editingSnippet.id, {
        title: formTitle.trim(),
        content: formContent.trim(),
      });
      setFormTitle('');
      setFormContent('');
      setEditingSnippet(null);
      setView('list');
      await fetchData();
    } catch (error) {
      setActionError(getUserVisibleErrorMessage(error, '更新提示词失败，请稍后重试。'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleDeleteSnippet = async (snippetId: string) => {
    if (!hasAuth || !token) return;
    setActionError(null);
    setPendingAction({ kind: 'delete-snippet', targetId: snippetId });
    try {
      await client.deleteSnippet(token, snippetId);
      await fetchData();
    } catch (error) {
      setActionError(getUserVisibleErrorMessage(error, '删除提示词失败，请稍后重试。'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleCopy = (text: string, id: string) => {
    void (async () => {
      setActionError(null);
      setPendingAction({ kind: 'copy-snippet', targetId: id });
      try {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        if (copiedResetTimerRef.current !== null) {
          window.clearTimeout(copiedResetTimerRef.current);
        }
        copiedResetTimerRef.current = window.setTimeout(() => {
          setCopiedId(null);
          copiedResetTimerRef.current = null;
        }, 1500);
      } catch (error) {
        if (isAbortLikeError(error)) {
          return;
        }
        setActionError('复制提示词失败，请检查剪贴板权限后重试。');
      } finally {
        setPendingAction(null);
      }
    })();
  };

  const handleInject = (text: string) => {
    onInject(text);
    onClose();
  };

  // ─── Derived ────────────────────────────────────────────────────────────

  const activeGroup = useMemo(() => {
    if (!activeGroupId) {
      return null;
    }
    return groups.find((group) => group.id === activeGroupId) ?? null;
  }, [activeGroupId, groups]);

  const filteredSnippets = activeGroup
    ? snippets.filter((snippet) => snippet.groupId === activeGroup.id)
    : activeGroupId
      ? []
      : snippets;
  const createGroupPending = pendingAction?.kind === 'create-group';
  const updateGroupPending = pendingAction?.kind === 'update-group';
  const createSnippetPending = pendingAction?.kind === 'create-snippet';
  const updateSnippetPending = pendingAction?.kind === 'update-snippet';

  const isPendingTarget = useCallback(
    (kind: PanelActionKind, targetId: string): boolean =>
      pendingAction?.kind === kind && pendingAction.targetId === targetId,
    [pendingAction],
  );

  if (!open) return null;

  // ─── Render (portal to body, same as CompanionStage) ────────────────────

  return createPortal(
    <>
      <style>{'@keyframes prompt-snippets-spin { to { transform: rotate(360deg); } }'}</style>
      {/* Click-outside scrim — same pattern as CompanionStage */}
      <button
        type="button"
        aria-label="关闭快捷提示词面板"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          zIndex: 998,
          cursor: 'default',
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="快捷提示词"
        aria-busy={loading || hasPendingAction}
        style={{
          position: 'fixed',
          bottom: popoverPosition?.bottom ?? 80,
          left: popoverPosition?.left ?? 16,
          zIndex: 999,
          width: 'min(480px, calc(100vw - 24px))',
          maxHeight: 'min(560px, calc(100vh - 96px))',
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px 10px',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--fg-strong)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              <BoltIcon />
            </span>
            快捷提示词
          </span>
          <button type="button" onClick={onClose} style={iconBtnStyle} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
          {actionError && (
            <InlineNotice
              tone="danger"
              message={actionError}
              actionLabel="清除"
              onAction={() => setActionError(null)}
            />
          )}
          {loadError && !actionError && (
            <InlineNotice
              tone="warning"
              message={loadError}
              actionLabel="重试"
              onAction={() => void fetchData()}
            />
          )}
          {!hasAuth ? (
            <div style={emptyStateStyle}>登录后可使用快捷提示词。</div>
          ) : (
            <>
              {view === 'list' && (
                <>
                  {/* Group tabs */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      flexWrap: 'wrap',
                      marginBottom: 10,
                    }}
                  >
                    {groups.map((g) => (
                      <div
                        key={g.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                          padding: '3px 4px 3px 10px',
                          borderRadius: 6,
                          border:
                            activeGroupId === g.id
                              ? '1px solid var(--accent)'
                              : '1px solid var(--border-subtle)',
                          background:
                            activeGroupId === g.id
                              ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                              : 'transparent',
                          transition: 'all 120ms ease',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveGroupId(g.id)}
                          onDoubleClick={() => {
                            setEditingGroup(g);
                            setFormName(g.name);
                            setView('edit-group');
                          }}
                          disabled={loading || hasPendingAction}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: activeGroupId === g.id ? 'var(--accent)' : 'var(--fg-muted)',
                            fontSize: 11,
                            fontWeight: 500,
                            cursor: loading || hasPendingAction ? 'not-allowed' : 'pointer',
                            opacity: loading || hasPendingAction ? 0.65 : 1,
                          }}
                          title="点击选中，双击编辑"
                        >
                          {g.name}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteGroup(g.id);
                          }}
                          title="删除分组"
                          disabled={hasPendingAction}
                          style={{
                            ...smallBtnStyle,
                            width: 18,
                            height: 18,
                            border: 'none',
                            opacity: hasPendingAction ? 0.45 : 0.8,
                          }}
                        >
                          {isPendingTarget('delete-group', g.id) ? <SpinnerIcon /> : <TrashIcon />}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setFormName('');
                        setView('add-group');
                      }}
                      style={{
                        ...iconBtnStyle,
                        width: 24,
                        height: 24,
                      }}
                      title="添加分组"
                      disabled={hasPendingAction}
                    >
                      <PlusIcon />
                    </button>
                  </div>

                  {/* Snippet list */}
                  {loading ? (
                    <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 8 }}>
                      加载中…
                    </div>
                  ) : filteredSnippets.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 8 }}>
                      {loadError
                        ? '暂时无法读取快捷提示词。'
                        : groups.length === 0
                          ? '请先创建一个分组'
                          : '当前分组暂无提示词'}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {filteredSnippets.map((s) => (
                        <div
                          key={s.id}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--bg-surface, var(--bg-base))',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--fg-strong)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                flex: 1,
                              }}
                            >
                              {s.title}
                            </span>
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                              <button
                                type="button"
                                onClick={() => handleCopy(s.content, s.id)}
                                title="复制"
                                disabled={hasPendingAction}
                                style={smallBtnStyle}
                              >
                                {isPendingTarget('copy-snippet', s.id) ? (
                                  <SpinnerIcon />
                                ) : copiedId === s.id ? (
                                  <CheckIcon />
                                ) : (
                                  <CopyIcon />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleInject(s.content)}
                                title="注入到输入框"
                                disabled={hasPendingAction}
                                style={{
                                  ...smallBtnStyle,
                                  background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                                  color: 'var(--accent)',
                                  border:
                                    '1px solid color-mix(in oklch, var(--accent) 30%, transparent)',
                                }}
                              >
                                <InjectIcon />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSnippet(s);
                                  setFormTitle(s.title);
                                  setFormContent(s.content);
                                  setView('edit-snippet');
                                }}
                                title="编辑"
                                disabled={hasPendingAction}
                                style={smallBtnStyle}
                              >
                                <EditIcon />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteSnippet(s.id)}
                                title="删除"
                                disabled={hasPendingAction}
                                style={{ ...smallBtnStyle, color: 'var(--danger)' }}
                              >
                                {isPendingTarget('delete-snippet', s.id) ? (
                                  <SpinnerIcon />
                                ) : (
                                  <TrashIcon />
                                )}
                              </button>
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--fg-muted)',
                              lineHeight: 1.4,
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {s.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add snippet button */}
                  {activeGroup && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormTitle('');
                        setFormContent('');
                        setView('add-snippet');
                      }}
                      style={{
                        marginTop: 8,
                        padding: '6px 12px',
                        borderRadius: 7,
                        border: '1px dashed var(--border-subtle)',
                        background: 'transparent',
                        color: 'var(--fg-muted)',
                        fontSize: 11,
                        cursor: 'pointer',
                        width: '100%',
                        textAlign: 'center',
                      }}
                      disabled={hasPendingAction}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <PlusIcon />
                        添加提示词
                      </span>
                    </button>
                  )}
                </>
              )}

              {/* Add Group Form */}
              {view === 'add-group' && (
                <FormSection
                  title="新建分组"
                  onCancel={() => setView('list')}
                  onConfirm={() => void handleCreateGroup()}
                  confirmLabel={createGroupPending ? '创建中…' : '创建'}
                  confirmDisabled={!formName.trim()}
                  pending={createGroupPending}
                >
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="分组名称"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreateGroup();
                    }}
                    style={inputStyle}
                  />
                </FormSection>
              )}

              {/* Edit Group Form */}
              {view === 'edit-group' && (
                <FormSection
                  title="编辑分组"
                  onCancel={() => {
                    setView('list');
                    setEditingGroup(null);
                  }}
                  onConfirm={() => void handleUpdateGroup()}
                  confirmLabel={updateGroupPending ? '保存中…' : '保存'}
                  confirmDisabled={!formName.trim()}
                  pending={updateGroupPending}
                  onDelete={() => {
                    if (editingGroup) void handleDeleteGroup(editingGroup.id);
                    setView('list');
                    setEditingGroup(null);
                  }}
                >
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="分组名称"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleUpdateGroup();
                    }}
                    style={inputStyle}
                  />
                </FormSection>
              )}

              {/* Add Snippet Form */}
              {view === 'add-snippet' && (
                <FormSection
                  title="新建提示词"
                  onCancel={() => setView('list')}
                  onConfirm={() => void handleCreateSnippet()}
                  confirmLabel={createSnippetPending ? '创建中…' : '创建'}
                  confirmDisabled={!formTitle.trim() || !formContent.trim()}
                  pending={createSnippetPending}
                >
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="标题（简短描述）"
                    autoFocus
                    style={inputStyle}
                  />
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="提示词内容"
                    rows={4}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
                  />
                </FormSection>
              )}

              {/* Edit Snippet Form */}
              {view === 'edit-snippet' && (
                <FormSection
                  title="编辑提示词"
                  onCancel={() => {
                    setView('list');
                    setEditingSnippet(null);
                  }}
                  onConfirm={() => void handleUpdateSnippet()}
                  confirmLabel={updateSnippetPending ? '保存中…' : '保存'}
                  confirmDisabled={!formTitle.trim() || !formContent.trim()}
                  pending={updateSnippetPending}
                >
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="标题"
                    autoFocus
                    style={inputStyle}
                  />
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="提示词内容"
                    rows={4}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
                  />
                </FormSection>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── Internal sub-components ────────────────────────────────────────────────

function FormSection({
  title,
  children,
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled,
  onDelete,
  pending = false,
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onDelete?: () => void;
  pending?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>{title}</span>
      {children}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            style={{
              ...actionBtnStyle,
              color: 'var(--danger)',
              border: '1px solid var(--danger-border)',
              marginRight: 'auto',
              opacity: pending ? 0.55 : 1,
            }}
          >
            删除
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={pending} style={actionBtnStyle}>
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled || pending}
          style={{
            ...actionBtnStyle,
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            border: 'none',
            opacity: confirmDisabled || pending ? 0.5 : 1,
            cursor: confirmDisabled || pending ? 'not-allowed' : 'pointer',
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function InlineNotice({
  tone,
  message,
  actionLabel,
  onAction,
}: {
  tone: 'warning' | 'danger';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const accentColor = tone === 'danger' ? 'var(--complement)' : 'var(--contrast)';
  const borderColor = tone === 'danger' ? 'var(--complement-border)' : 'var(--contrast-border)';
  const backgroundColor =
    tone === 'danger'
      ? 'color-mix(in oklch, var(--complement) 10%, transparent)'
      : 'color-mix(in oklch, var(--contrast) 10%, transparent)';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '8px 10px',
        marginBottom: 10,
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background: backgroundColor,
        color: 'var(--fg-default)',
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      <span>{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            border: 'none',
            background: 'transparent',
            color: accentColor,
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            padding: 0,
            flexShrink: 0,
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid transparent',
  cursor: 'pointer',
  color: 'var(--fg-muted)',
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  padding: 4,
  transition:
    'background 100ms ease, border-color 100ms ease, color 100ms ease, opacity 100ms ease',
};

const smallBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 5,
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontSize: 11,
  color: 'var(--fg-muted)',
  transition:
    'background 100ms ease, border-color 100ms ease, color 100ms ease, opacity 100ms ease',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
  fontFamily: 'inherit',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 7,
  border: '1px solid var(--border-default)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const emptyStateStyle: React.CSSProperties = {
  padding: '16px 8px',
  color: 'var(--fg-muted)',
  fontSize: 12,
  lineHeight: 1.6,
};
