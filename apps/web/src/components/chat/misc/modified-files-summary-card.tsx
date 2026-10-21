import { useCallback } from 'react';
import type { FileDiffContent, ModifiedFilesSummaryContent } from '@openAwork/shared';
import { useFileEditorContext } from '../../../App.js';
import { PathPreviewPopover } from '../file-preview/path-preview-popover.js';
import { usePathHoverPreview } from '../file-preview/use-path-hover-preview.js';

const MAX_VISIBLE_FILES = 6;

function formatStatusLabel(status: FileDiffContent['status']): string {
  if (status === 'added') return '新增';
  if (status === 'deleted') return '删除';
  return '修改';
}

function formatSourceLabel(sourceKind: FileDiffContent['sourceKind']): string | null {
  if (sourceKind === 'structured_tool_diff') return '工具';
  if (sourceKind === 'workspace_reconcile') return '工作区';
  if (sourceKind === 'restore_replay') return '恢复';
  if (sourceKind === 'manual_revert') return '回退';
  if (sourceKind === 'session_snapshot') return '快照';
  return null;
}

/**
 * 修改摘要行里的文件路径。
 *
 * 与 markdown 行内引用、工具输出预览同构：点击经 `FileEditorContext` 打开编辑器，
 * 悬浮给出内容片段。`file.file` 的形态不固定（工具写入时是工作区相对路径，
 * reconcile / 快照来源可能是绝对路径），绝对化由 `openFile` 内部统一处理，这里
 * 只负责把原始 token 原样传下去，错误提示才对得上用户看到的那个路径。
 *
 * 无 `FileEditorContext`（产物查看器等非聊天页）时降级为纯文本 span。
 */
function SummaryFilePath({ path }: { path: string }) {
  const { openRef, isAvailable } = useFileEditorContext();
  // 可用性走响应式布尔，不在渲染期读 ref —— 渲染期读 `.current` 会让 React Compiler
  // 放弃优化本组件（"Cannot access refs during render"）。
  const canOpen = isAvailable && path.trim().length > 0;
  const hover = usePathHoverPreview({ enabled: canOpen });
  // 刻意先解构再用：把 `hover.setAnchorEl` 这种**成员访问**直接塞进 `ref=`
  // 会被 React Compiler 判成渲染期访问 ref（实测与命名无关——换成中性名字同样脱靶，
  // 解构成本地变量则正常编译）。它传的其实是个 state setter，不是 ref。
  const { setAnchorEl } = hover;

  const handleClick = useCallback(() => {
    openRef.current?.(path);
  }, [openRef, path]);

  if (!canOpen) {
    return (
      <span className="chat-modified-summary-path" data-interactive="false" title={path}>
        {path}
      </span>
    );
  }

  return (
    <>
      <button
        ref={setAnchorEl}
        type="button"
        className="chat-modified-summary-path"
        data-interactive="true"
        onClick={handleClick}
        onMouseEnter={hover.triggerHandlers.onMouseEnter}
        onMouseLeave={hover.triggerHandlers.onMouseLeave}
        onFocus={hover.triggerHandlers.onFocus}
        onBlur={hover.triggerHandlers.onBlur}
        title={`点击打开 ${path}`}
      >
        {path}
      </button>
      {hover.open && hover.anchorEl ? (
        <PathPreviewPopover
          anchorEl={hover.anchorEl}
          path={path}
          line={null}
          onMouseEnter={hover.panelHandlers.onMouseEnter}
          onMouseLeave={hover.panelHandlers.onMouseLeave}
        />
      ) : null}
    </>
  );
}

export function ModifiedFilesSummaryCard({ summary }: { summary: ModifiedFilesSummaryContent }) {
  if (summary.files.length === 0) {
    return null;
  }

  const totalAdditions = summary.files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = summary.files.reduce((sum, file) => sum + file.deletions, 0);
  const visibleFiles = summary.files.slice(0, MAX_VISIBLE_FILES);
  const hiddenCount = summary.files.length - visibleFiles.length;

  return (
    <div
      data-chat-modified-summary="true"
      style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--fg-default)',
        }}
      >
        <span>{summary.title}</span>
        <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
          {summary.files.length} 个文件 · +{totalAdditions} / -{totalDeletions}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleFiles.map((file) => {
          const sourceLabel = formatSourceLabel(file.sourceKind);
          return (
            <div
              key={`${file.file}:${file.status ?? 'modified'}`}
              data-chat-modified-summary-file="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 0',
                fontSize: 12,
              }}
            >
              <span
                style={{
                  color: 'var(--fg-muted)',
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 28,
                }}
              >
                {formatStatusLabel(file.status)}
              </span>
              <SummaryFilePath path={file.file} />
              {(sourceLabel || file.guaranteeLevel) && (
                <span style={{ fontSize: 10, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                  {[sourceLabel, file.guaranteeLevel].filter(Boolean).join(' · ')}
                </span>
              )}
              <span
                style={{
                  color: 'var(--fg-muted)',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                }}
              >
                +{file.additions} / -{file.deletions}
              </span>
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '2px 0' }}>
            另外还有 {hiddenCount} 个文件变更未展开。
          </div>
        )}
      </div>
    </div>
  );
}
