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
  const [view, setView] = useState<PanelView>('list');
  const [editingGroup, setEditingGroup] = useState<PromptSnippetGroup | null>(null);
  const [editingSnippet, setEditingSnippet] = useState<PromptSnippet | null>(null);
  const [formName, setFormName] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ bottom: number; left: number } | null>(
    null,
  );

  const panelRef = useRef<HTMLDivElement>(null);

  const client = useMemo(() => createPromptSnippetsClient(gatewayUrl), [gatewayUrl]);

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
    if (!token) return;
    setLoading(true);
    try {
      const [g, s] = await Promise.all([client.listGroups(token), client.listSnippets(token)]);
      setGroups(g);
      setSnippets(s);
      // Auto-select first group if none is active
      setActiveGroupId((current) => {
        if (!current && g.length > 0) return g[0]!.id;
        return current;
      });
    } catch {
      // silent — user will see empty state
    } finally {
      setLoading(false);
    }
  }, [client, token]);

  useEffect(() => {
    if (open) void fetchData();
  }, [open, fetchData]);

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
    if (!token || !formName.trim()) return;
    await client.createGroup(token, { name: formName.trim() });
    setFormName('');
    setView('list');
    void fetchData();
  };

  const handleUpdateGroup = async () => {
    if (!token || !editingGroup || !formName.trim()) return;
    await client.updateGroup(token, editingGroup.id, { name: formName.trim() });
    setFormName('');
    setEditingGroup(null);
    setView('list');
    void fetchData();
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!token) return;
    await client.deleteGroup(token, groupId);
    if (activeGroupId === groupId) setActiveGroupId(null);
    void fetchData();
  };

  const handleCreateSnippet = async () => {
    if (!token || !formTitle.trim() || !formContent.trim() || !activeGroupId) return;
    await client.createSnippet(token, {
      groupId: activeGroupId,
      title: formTitle.trim(),
      content: formContent.trim(),
    });
    setFormTitle('');
    setFormContent('');
    setView('list');
    void fetchData();
  };

  const handleUpdateSnippet = async () => {
    if (!token || !editingSnippet || !formTitle.trim() || !formContent.trim()) return;
    await client.updateSnippet(token, editingSnippet.id, {
      title: formTitle.trim(),
      content: formContent.trim(),
    });
    setFormTitle('');
    setFormContent('');
    setEditingSnippet(null);
    setView('list');
    void fetchData();
  };

  const handleDeleteSnippet = async (snippetId: string) => {
    if (!token) return;
    await client.deleteSnippet(token, snippetId);
    void fetchData();
  };

  const handleCopy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleInject = (text: string) => {
    onInject(text);
    onClose();
  };

  // ─── Derived ────────────────────────────────────────────────────────────

  const filteredSnippets = activeGroupId
    ? snippets.filter((s) => s.groupId === activeGroupId)
    : snippets;

  if (!open) return null;

  // ─── Render (portal to body, same as CompanionStage) ────────────────────

  return createPortal(
    <>
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
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>
            ⚡ 快捷提示词
          </span>
          <button type="button" onClick={onClose} style={iconBtnStyle} aria-label="关闭">
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
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
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: activeGroupId === g.id ? 'var(--accent)' : 'var(--fg-muted)',
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: 'pointer',
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
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: '0 2px',
                        cursor: 'pointer',
                        color: 'var(--fg-muted)',
                        fontSize: 10,
                        lineHeight: 1,
                        opacity: 0.6,
                        borderRadius: 3,
                      }}
                    >
                      ✕
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
                    fontSize: 13,
                    width: 24,
                    height: 24,
                  }}
                  title="添加分组"
                >
                  +
                </button>
              </div>

              {/* Snippet list */}
              {loading ? (
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 8 }}>加载中…</div>
              ) : filteredSnippets.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 8 }}>
                  {groups.length === 0 ? '请先创建一个分组' : '当前分组暂无提示词'}
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
                        background: 'var(--bg-surface, var(--bg-base)',
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
                            style={smallBtnStyle}
                          >
                            {copiedId === s.id ? '✓' : '📋'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInject(s.content)}
                            title="注入到输入框"
                            style={{
                              ...smallBtnStyle,
                              background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                              color: 'var(--accent)',
                              border:
                                '1px solid color-mix(in oklch, var(--accent) 30%, transparent)',
                            }}
                          >
                            ↵
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
                            style={smallBtnStyle}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteSnippet(s.id)}
                            title="删除"
                            style={{ ...smallBtnStyle, color: 'var(--danger)' }}
                          >
                            ✕
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
              {activeGroupId && (
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
                >
                  + 添加提示词
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
              confirmLabel="创建"
              confirmDisabled={!formName.trim()}
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
              confirmLabel="保存"
              confirmDisabled={!formName.trim()}
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
              confirmLabel="创建"
              confirmDisabled={!formTitle.trim() || !formContent.trim()}
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
              confirmLabel="保存"
              confirmDisabled={!formTitle.trim() || !formContent.trim()}
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
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onDelete?: () => void;
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
            style={{
              ...actionBtnStyle,
              color: 'var(--danger)',
              border: '1px solid var(--danger-border)',
              marginRight: 'auto',
            }}
          >
            删除
          </button>
        )}
        <button type="button" onClick={onCancel} style={actionBtnStyle}>
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          style={{
            ...actionBtnStyle,
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            border: 'none',
            opacity: confirmDisabled ? 0.5 : 1,
            cursor: confirmDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--fg-muted)',
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
  padding: 2,
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
  transition: 'background 100ms ease',
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
