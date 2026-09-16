/**
 * 260530-team-page · Wave 2 · TeamFilePreviewPanel（F5 文件内联预览面板）
 *
 * 浮层式文件预览：单击文件树节点时从右侧滑出，复用 FilePreviewPane（文本/md/
 * 代码/图片/SVG/JSON/二进制 notice 全分支）。
 *
 * 与"打开到编辑器"并存：单击预览（轻量、不进 tab），用户可在面板内点
 * "在编辑器中打开" 走 onOpenInEditor 进完整编辑器。
 *
 * 预览体带右键菜单（与文件编辑器同源，见内容面共用的 ContentContextMenuHost
 * 与 buildContentContextMenuItems）；这里的能力集比编辑器窄——没有 Monaco 编辑
 * 动作、也没有「切换到预览视图」（本来就只在预览），因此只装配对应的回调。
 */

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  ContextMenu,
  type ContextMenuItem,
} from '../../../../../components/common/display/ContextMenu.js';
import {
  ContentContextMenuHost,
  type ContentContextMenuTrigger,
} from '../../../../../components/common/display/ContentContextMenuHost.js';
import { buildContentContextMenuItems } from '../../../../../components/common/display/content-context-menu-items.js';
import { FilePreviewPane } from '../../../../../components/file-editor/preview/FilePreviewPane.js';
import { copyTextToClipboard } from '../../../../../components/layout/file-tree/file-tree-actions.js';
import { dispatchComposerReference } from '../../../../../utils/chat/composer-reference-events.js';
import {
  getFilePreviewKind,
  isNonTextPreviewKind,
} from '../../../../../utils/file/file-preview.js';
import {
  canOpenPathInSystem,
  openPathInSystem,
} from '../../../../../utils/tauri/open-in-system.js';
import { toast } from '../../../../../components/common/feedback/ToastNotification.js';
import { EmptyState } from '../../shared/content-kit/index.js';

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(560px, 60vw)',
  zIndex: 120,
  display: 'flex',
  flexDirection: 'column',
  background: 'color-mix(in srgb, var(--bg-overlay) 97%, var(--bg-base))',
  borderLeft: '1px solid color-mix(in srgb, var(--border-default) 70%, transparent)',
  boxShadow: 'var(--shadow-lg)',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  flexShrink: 0,
};

const BTN_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

export interface TeamFilePreviewPanelProps {
  path: string | null;
  content: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  /** "在编辑器中打开" 回调；不传则不显示该按钮，菜单里也不出现该项。 */
  onOpenInEditor?: (path: string) => void;
  /** 工作区根路径，用于菜单里的相对路径 / 引用到对话；缺失时退回绝对路径。 */
  workspacePath?: string | null;
}

export function TeamFilePreviewPanel({
  path,
  content,
  loading,
  error,
  onClose,
  onOpenInEditor,
  workspacePath = null,
}: TeamFilePreviewPanelProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; selection: string } | null>(null);

  // 与文件编辑器同款：能力在页面生命周期内不变，探测一次即可。
  const [canOpenInSystem] = useState(canOpenPathInSystem);

  const handleOpenMenu = useCallback((trigger: ContentContextMenuTrigger) => {
    setMenu({ x: trigger.x, y: trigger.y, selection: trigger.selection });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleCopy = useCallback((text: string) => {
    void copyTextToClipboard(text).catch((copyError: unknown) => {
      toast(copyError instanceof Error ? copyError.message : '复制失败', 'error');
    });
  }, []);

  const handleOpenInSystem = useCallback((targetPath: string) => {
    void openPathInSystem(targetPath).catch((openError: unknown) => {
      toast(openError instanceof Error ? openError.message : '用系统默认程序打开失败', 'error');
    });
  }, []);

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu || !path) return [];
    const previewKind = getFilePreviewKind(path);
    return buildContentContextMenuItems({
      variant: 'preview',
      target: {
        path,
        content,
        selection: menu.selection,
        // 浮层没有"活跃标签"概念，不展示 ⌘W 提示。
        isActive: false,
        isBinary: isNonTextPreviewKind(previewKind),
      },
      workspacePath,
      actions: {
        copyText: handleCopy,
        referenceToChat: dispatchComposerReference,
        close: onClose,
        ...(onOpenInEditor ? { switchToCode: () => onOpenInEditor(path) } : {}),
        ...(canOpenInSystem ? { openInSystem: () => handleOpenInSystem(path) } : {}),
      },
    });
  }, [
    menu,
    path,
    content,
    workspacePath,
    handleCopy,
    onClose,
    onOpenInEditor,
    canOpenInSystem,
    handleOpenInSystem,
  ]);

  if (!path) return null;

  const filename = path.split('/').pop() ?? path;

  const body = (
    <div style={OVERLAY_STYLE} role="dialog" aria-label={`预览 ${filename}`}>
      <header style={HEADER_STYLE}>
        <span aria-hidden style={{ fontSize: 14 }}>
          📄
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--fg-strong)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={path}
        >
          {filename}
        </span>
        {onOpenInEditor ? (
          <button type="button" style={BTN_STYLE} onClick={() => onOpenInEditor(path)}>
            在编辑器中打开
          </button>
        ) : null}
        <button
          type="button"
          style={BTN_STYLE}
          onClick={onClose}
          aria-label="关闭预览"
          title="关闭预览"
        >
          ✕
        </button>
      </header>

      {error ? (
        <div
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: 'var(--warning)',
            background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)',
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--fg-muted)',
            fontSize: 12,
          }}
        >
          加载文件内容…
        </div>
      ) : (
        <ContentContextMenuHost testId="team-file-preview-host" onOpen={handleOpenMenu}>
          {error && !content ? (
            <EmptyState
              emoji="⚠️"
              title="无法预览"
              description={error}
              style={{ flex: 1, margin: 12 }}
            />
          ) : (
            <FilePreviewPane path={path} content={content} />
          )}
        </ContentContextMenuHost>
      )}

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} /> : null}
    </div>
  );

  return createPortal(body, document.body);
}
