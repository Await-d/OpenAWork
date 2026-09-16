import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getPathBasename } from '../../../utils/workspace-path.js';

/** 下拉浮层宽度，需与 `ChatComposer.css` 中 `.composer-workspace-menu` 的 width 保持一致。 */
const MENU_WIDTH = 320;
/** 首次测量前用于决定向上/向下展开的高度估算值。 */
const MENU_ESTIMATED_HEIGHT = 360;
/** 浮层与触发按钮之间的间距。 */
const MENU_OFFSET = 8;
/** 浮层最大高度，与 `ChatComposer.css` 中 max-height 保持一致。 */
const MENU_MAX_HEIGHT = 420;

interface WorkspaceOptionEntry {
  id: string;
  kind: 'workspace';
  path: string;
  label: string;
}

type WorkspaceMenuEntry =
  WorkspaceOptionEntry | { id: string; kind: 'clear' | 'create' | 'local-folder' | 'ssh' };

/** 当前绑定的 SSH 远端连接（用于在菜单与触发按钮上标注远端工作区）。 */
export interface ComposerSshConnectionSummary {
  id: string;
  /** 展示名：连接名或 `user@host:port`。 */
  label: string;
}

export interface ComposerWorkspaceMenuProps {
  /** 当前会话/草稿绑定的工作区绝对路径；null 表示未绑定。 */
  currentPath: string | null;
  /** 最近使用的已保存工作区路径（最近使用在前）。 */
  savedWorkspacePaths: readonly string[];
  /** 绑定到指定工作区路径。 */
  onSelectWorkspace: (path: string) => void | Promise<void>;
  /** 解除当前工作区绑定。 */
  onClearWorkspace: () => void | Promise<void>;
  /** 新建工作空间（打开浏览弹窗并直接展开新建表单）。 */
  onCreateWorkspace: () => void;
  /** 打开本地文件夹：桌面端走原生选择器，浏览器端退化为浏览弹窗。 */
  onOpenLocalFolder: () => void;
  /** 绑定操作进行中时禁用交互。 */
  busy?: boolean;
  /**
   * 「连接 SSH 远端目录」入口：点击后打开 SSH 远端目录选择弹窗。
   * 未提供时不渲染该动作，其它调用点（team 会话等）不受影响。
   */
  onOpenSshWorkspace?: () => void;
  /**
   * 当前绑定的 SSH 远端连接（草稿态）；非空时菜单顶部提示「命令在远端执行」，
   * 触发按钮同步显示 SSH 徽标，避免把远端路径误当成本地目录。
   */
  currentSshConnection?: ComposerSshConnectionSummary | null;
}

function matchesQuery(path: string, label: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return (
    label.toLowerCase().includes(normalizedQuery) || path.toLowerCase().includes(normalizedQuery)
  );
}

function FolderGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** SSH 远端工作区图标（服务器机架）。 */
function ServerGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <line x1="7" y1="7.5" x2="7.01" y2="7.5" />
      <line x1="7" y1="16.5" x2="7.01" y2="16.5" />
    </svg>
  );
}

/** 「不绑定工作区」图标（取消圆圈）。 */
function ClearGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

/** 「新建工作空间」图标（加号）。 */
function PlusGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** 动作类条目的图标 / 文案 / 提示集中一处，避免渲染层堆叠多层三元。 */
function describeActionEntry(kind: 'clear' | 'create' | 'local-folder' | 'ssh'): {
  icon: ReactNode;
  label: string;
  hint?: string;
} {
  switch (kind) {
    case 'clear':
      return { icon: <ClearGlyph />, label: '不绑定工作区' };
    case 'create':
      return { icon: <PlusGlyph />, label: '新建工作空间' };
    case 'local-folder':
      return { icon: <FolderGlyph />, label: '打开本地文件夹' };
    case 'ssh':
      return {
        icon: <ServerGlyph />,
        label: '连接 SSH 远端目录',
        // 远端绑定既支持复用已有连接，也支持现场新建 / 编辑并持久化，提示里一并说明。
        hint: '在远程主机上浏览并绑定目录；可在弹窗内新建、编辑连接并测试连通',
      };
  }
}

/**
 * 输入框外壳上方的「选择工作空间」下拉（外层、左对齐）。
 *
 * 覆盖四类能力：搜索/切换已保存工作区、解除绑定、新建或打开本地文件夹，
 * 以及「连接 SSH 远端目录」——绑定了远端目录时提示命令将在远程主机执行。
 * 仅在会话尚未开始对话（绑定未锁定）时由上层渲染；浮层通过 portal 挂到 body，
 * 避免被顶栏 / composer 的 `overflow: hidden` 裁剪。
 */
export function ComposerWorkspaceMenu({
  currentPath,
  savedWorkspacePaths,
  onSelectWorkspace,
  onClearWorkspace,
  onCreateWorkspace,
  onOpenLocalFolder,
  busy = false,
  onOpenSshWorkspace,
  currentSshConnection = null,
}: ComposerWorkspaceMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  /** 用户是否用方向键 / 悬停主动移动过高亮项（避免回车误触“操作类”条目）。 */
  const [navigated, setNavigated] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    setNavigated(false);
  }, []);

  const workspaceEntries = useMemo(
    () =>
      savedWorkspacePaths
        .map((path) => ({ path, label: getPathBasename(path, path) }))
        .filter((item) => matchesQuery(item.path, item.label, query))
        .map<WorkspaceOptionEntry>((item, index) => ({
          id: `composer-workspace-option-${index}`,
          kind: 'workspace',
          path: item.path,
          label: item.label,
        })),
    [query, savedWorkspacePaths],
  );

  const actionEntries = useMemo<WorkspaceMenuEntry[]>(
    () => [
      ...(currentPath ? [{ id: 'composer-workspace-clear', kind: 'clear' as const }] : []),
      { id: 'composer-workspace-create', kind: 'create' as const },
      { id: 'composer-workspace-local-folder', kind: 'local-folder' as const },
      ...(onOpenSshWorkspace ? [{ id: 'composer-workspace-ssh', kind: 'ssh' as const }] : []),
    ],
    [currentPath, onOpenSshWorkspace],
  );

  const entries = useMemo(
    () => [...workspaceEntries, ...actionEntries],
    [actionEntries, workspaceEntries],
  );
  const activeEntryId = entries[activeIndex]?.id ?? null;

  const runEntry = useCallback(
    (entry: WorkspaceMenuEntry) => {
      closeMenu();

      switch (entry.kind) {
        case 'workspace':
          void Promise.resolve(onSelectWorkspace(entry.path)).catch(() => undefined);
          return;
        case 'clear':
          void Promise.resolve(onClearWorkspace()).catch(() => undefined);
          return;
        case 'create':
          onCreateWorkspace();
          return;
        case 'local-folder':
          onOpenLocalFolder();
          return;
        case 'ssh':
          onOpenSshWorkspace?.();
          return;
      }
    },
    [
      closeMenu,
      onClearWorkspace,
      onCreateWorkspace,
      onOpenLocalFolder,
      onOpenSshWorkspace,
      onSelectWorkspace,
    ],
  );

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        triggerRef.current?.focus();
        return;
      }

      if (entries.length === 0) {
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % entries.length);
        setNavigated(true);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + entries.length) % entries.length);
        setNavigated(true);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const entry = entries[activeIndex];
        if (!entry) {
          return;
        }

        // 高亮停在“操作类”条目（解绑 / 新建 / 本地文件夹）时，只有用户主动用
        // 方向键或悬停选中过才执行，避免搜索无结果时回车误触解绑。
        if (entry.kind === 'workspace' || navigated) {
          runEntry(entry);
        }
      }
    },
    [activeIndex, closeMenu, entries, navigated, runEntry],
  );

  const updatePosition = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const height = popoverRef.current?.offsetHeight ?? MENU_ESTIMATED_HEIGHT;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = Math.max(MENU_OFFSET, viewportWidth - MENU_WIDTH - MENU_OFFSET);
    const left = Math.min(Math.max(MENU_OFFSET, rect.left), maxLeft);
    const spaceBelow = viewportHeight - rect.bottom;

    // 向上展开时以输入框外壳的顶边为上限：浮层只覆盖上方的会话内容区，
    // 不遮挡输入框与工具条。找不到外壳时退化为以触发按钮为界。
    const composerShell = trigger
      .closest('.chat-composer__inner')
      ?.querySelector<HTMLElement>('.composer-shell');
    const shellTop = composerShell?.getBoundingClientRect().top ?? rect.top;
    const aboveBottomLimit = Math.min(rect.top, shellTop) - MENU_OFFSET;
    const placeAbove = spaceBelow < height + MENU_OFFSET * 2 && aboveBottomLimit > MENU_OFFSET;
    const top = placeAbove
      ? Math.max(MENU_OFFSET, aboveBottomLimit - height)
      : rect.bottom + MENU_OFFSET;
    // 上方空间不足以容纳整块浮层时同步压缩高度，避免它越过输入框顶边。
    const maxHeight = placeAbove
      ? Math.min(MENU_MAX_HEIGHT, Math.max(MENU_OFFSET * 4, aboveBottomLimit - MENU_OFFSET))
      : MENU_MAX_HEIGHT;

    setPosition((previous) =>
      previous &&
      Math.abs(previous.left - left) < 1 &&
      Math.abs(previous.top - top) < 1 &&
      Math.abs(previous.maxHeight - maxHeight) < 1
        ? previous
        : { left, top, maxHeight },
    );
  }, []);

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    if (open && position && popoverRef.current) {
      // 首帧按估算高度定位，这里用真实高度校正一次，避免向上展开时压住触发按钮。
      updatePosition();
    }
  }, [open, position, updatePosition]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const handleViewportChange = () => {
      updatePosition();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }

      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.stopPropagation();
      closeMenu();
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveIndex(0);
    setNavigated(false);
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (activeIndex >= entries.length) {
      setActiveIndex(entries.length > 0 ? entries.length - 1 : 0);
    }
  }, [activeIndex, entries.length]);

  // 键盘导航时让高亮项保持在可视区域内（列表超长 / 滚动后）。
  useEffect(() => {
    if (!open || !activeEntryId) {
      return;
    }

    const node = popoverRef.current?.querySelector<HTMLElement>(`[id="${activeEntryId}"]`);
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [activeEntryId, open]);

  const triggerLabel = currentPath ? getPathBasename(currentPath, currentPath) : '选择工作空间';
  const isCurrentEntry = (entry: WorkspaceMenuEntry) =>
    entry.kind === 'workspace' && entry.path === currentPath;
  /** 已绑定 SSH 远端：触发按钮与菜单都要显式标注，避免把远端路径误当成本地目录。 */
  const sshBound = currentSshConnection !== null;
  const triggerTitle = sshBound
    ? `SSH 远端（${currentSshConnection.label}）\n${currentPath ?? ''}\n命令将在远程主机执行`
    : (currentPath ?? '为即将创建的会话绑定工作目录');
  const triggerAriaLabel = sshBound
    ? `选择工作空间，当前为 SSH 远端：${currentSshConnection.label}${
        currentPath ? `，路径 ${currentPath}` : ''
      }`
    : currentPath
      ? `选择工作空间，当前：${currentPath}`
      : '选择工作空间';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="composer-workspace-trigger"
        data-bound={currentPath ? 'true' : 'false'}
        data-ssh={sshBound ? 'true' : 'false'}
        data-testid="composer-workspace-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        title={triggerTitle}
        disabled={busy}
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }

          setOpen(true);
        }}
      >
        {sshBound ? <ServerGlyph /> : <FolderGlyph />}
        {sshBound && <span className="composer-workspace-trigger__badge">SSH</span>}
        <span className="composer-workspace-trigger__label">{triggerLabel}</span>
        <svg
          aria-hidden="true"
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open &&
        position &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="选择工作空间"
            data-testid="composer-workspace-menu"
            className="composer-workspace-menu"
            style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
          >
            <div className="composer-workspace-menu__search">
              <svg
                aria-hidden="true"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                className="composer-workspace-menu__search-input"
                value={query}
                placeholder="搜索工作空间"
                role="combobox"
                aria-label="搜索工作空间"
                aria-expanded
                aria-controls="composer-workspace-listbox"
                aria-autocomplete="list"
                aria-activedescendant={activeEntryId ?? undefined}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setActiveIndex(0);
                  // 输入新查询后复位键盘导航标记，避免继承上一次的高亮位置。
                  setNavigated(false);
                }}
                onKeyDown={handleSearchKeyDown}
              />
            </div>

            {currentSshConnection && (
              <div
                className="composer-workspace-menu__ssh-notice"
                data-testid="composer-workspace-ssh-notice"
              >
                <ServerGlyph />
                <span className="composer-workspace-menu__ssh-notice-text">
                  当前绑定 SSH 远端：{currentSshConnection.label}
                  ，命令执行与文件读写都发生在远程主机
                </span>
              </div>
            )}

            <div
              className="composer-workspace-menu__list"
              id="composer-workspace-listbox"
              role="listbox"
              aria-label="工作空间"
            >
              {workspaceEntries.length === 0 ? (
                <div className="composer-workspace-menu__empty">
                  {savedWorkspacePaths.length === 0
                    ? '还没有使用过的工作区'
                    : `未找到匹配「${query.trim()}」的工作区`}
                </div>
              ) : (
                workspaceEntries.map((entry) => (
                  <button
                    key={entry.id}
                    id={entry.id}
                    type="button"
                    role="option"
                    aria-selected={isCurrentEntry(entry)}
                    data-active={entry.id === activeEntryId}
                    data-testid="composer-workspace-option"
                    className="composer-workspace-menu__item"
                    disabled={busy}
                    title={entry.path}
                    onMouseEnter={() => {
                      const index = entries.findIndex((item) => item.id === entry.id);
                      if (index >= 0) {
                        setActiveIndex(index);
                        setNavigated(true);
                      }
                    }}
                    onClick={() => runEntry(entry)}
                  >
                    <span className="composer-workspace-menu__item-icon">
                      <FolderGlyph />
                    </span>
                    <span className="composer-workspace-menu__item-body">
                      <span className="composer-workspace-menu__item-label">{entry.label}</span>
                      <span className="composer-workspace-menu__item-path">{entry.path}</span>
                    </span>
                    {isCurrentEntry(entry) && (
                      <svg
                        aria-hidden="true"
                        className="composer-workspace-menu__item-check"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>

            <div className="composer-workspace-menu__divider" />

            <div className="composer-workspace-menu__actions">
              {actionEntries.map((entry) => {
                if (entry.kind === 'workspace') {
                  return null;
                }

                const action = describeActionEntry(entry.kind);
                return (
                  <button
                    key={entry.id}
                    id={entry.id}
                    type="button"
                    data-active={entry.id === activeEntryId}
                    data-testid={`composer-workspace-action-${entry.kind}`}
                    className={`composer-workspace-menu__item composer-workspace-menu__item--action${
                      entry.kind === 'clear' ? ' composer-workspace-menu__item--clear' : ''
                    }`}
                    disabled={busy}
                    onMouseEnter={() => {
                      const index = entries.findIndex((item) => item.id === entry.id);
                      if (index >= 0) {
                        setActiveIndex(index);
                        setNavigated(true);
                      }
                    }}
                    onClick={() => runEntry(entry)}
                  >
                    <span className="composer-workspace-menu__item-icon">{action.icon}</span>
                    <span className="composer-workspace-menu__item-body">
                      <span className="composer-workspace-menu__item-label">{action.label}</span>
                      {action.hint && (
                        <span className="composer-workspace-menu__item-hint">{action.hint}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
