/**
 * `desktop_automation` / `desktop_control` 专用卡片。
 *
 * 这两个工具原先走 block 卡的通用输出：`{"ok":true}` 被渲染成「1 个字段」的
 * 键值表，`screenshot` 只为了一张缩略图把 `artifactId` / `mimeType` 一并铺出来。
 * 卡片把入参的 action 提炼成标题与目标摘要，展开体只保留三件有用的事：
 * 动作上下文、截图（如有）、读取类动作的真实返回；确认型动作不再刷字段表。
 */

import { resolveToolVisualStatus, type ToolCallCardProps } from '@openAwork/shared-ui';
import { useMemo } from 'react';
import { useToolExpandDefault } from '../../../../stores/settings/use-tool-expand-default.js';
import { ToolIcon } from '../display/tool-icon.js';
import { ToolCallImagePreview } from '../io/ToolCallImagePreview.js';
import { ToolInputPreview } from '../io/tool-input-preview.js';
import { ToolOutputPreview } from '../io/tool-output-preview.js';
import { DesktopOutputPreview } from '../previews/desktop-output-preview.js';
import { getToolCategory } from '../shared/colorize-summary.js';
import { parseDesktopOutput } from '../shared/desktop-output-view.js';
import { desktopToolTitle, resolveDesktopToolView } from '../shared/desktop-tool-view.js';
import { extractErrorSummary } from '../shared/extract-error-summary.js';
import { formatElapsed } from '../shared/format.js';
import { ToolApprovalActions } from '../shared/tool-approval-actions.js';
import { resolveToolCallImageSource } from '../shared/tool-call-image-source.js';
import { useToolCallExpandState } from '../shared/use-tool-call-expand-state.js';

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: 'var(--fg-muted)',
};

const FIELD_VALUE_STYLE: React.CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.55,
  color: 'var(--fg-default)',
  fontFamily:
    'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
  wordBreak: 'break-word',
};

/** 失败原因横幅（danger 语义色；与 computer_use 卡片同款）。 */
function FailureBanner({ reason }: { reason: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: '8px 12px',
        borderRadius: 6,
        background: 'var(--danger-muted)',
        border: '1px solid var(--danger-border)',
        color: 'var(--danger)',
        fontSize: 11.5,
        lineHeight: 1.55,
      }}
    >
      <span style={{ fontWeight: 700, marginRight: 6 }}>失败原因</span>
      {reason}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={SECTION_LABEL_STYLE}>{label}</span>
      <span style={FIELD_VALUE_STYLE} title={value}>
        {value}
      </span>
    </div>
  );
}

export function DesktopToolCard({
  approvalActions,
  pendingPermissionRequestId,
  kind,
  toolName,
  input,
  output,
  status,
  isError,
  durationMs,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
  pendingPermissionRequestId?: string;
  kind?: ToolCallCardProps['kind'];
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  durationMs?: number;
}) {
  const normalized = toolName.trim().toLowerCase();
  const visualState = resolveToolVisualStatus({
    defaultStatus: 'running',
    isError,
    output,
    status,
  });

  const view = useMemo(
    () => resolveDesktopToolView({ toolName: normalized, input, output, isError }),
    [normalized, input, output, isError],
  );
  const imageSource = useMemo(
    () => resolveToolCallImageSource(normalized, input, output),
    [normalized, input, output],
  );
  // 读取类动作先试专用视图（状态 / 控制台 / 网络 / 元素 / iframe / 快照），
  // 认不出形状时 `none` 让下面回退到通用渲染，避免把普通 JSON 误画成空列表。
  const action = typeof input['action'] === 'string' ? input['action'].trim() : '';
  const outputNode = useMemo(
    () =>
      view.payloadKind === 'data' ? parseDesktopOutput(action, output) : { kind: 'none' as const },
    [view.payloadKind, action, output],
  );

  const shouldExpandByDefault = useToolExpandDefault()(toolName);
  const [open, toggleOpen] = useToolCallExpandState({
    shouldAutoExpand: shouldExpandByDefault,
    shouldExpandByDefault,
  });

  const summary = [view.actionLabel, view.targetLabel].filter(Boolean).join(' · ');
  const errorSummary =
    view.errorText ?? (visualState === 'failed' ? extractErrorSummary(output, isError) : null);
  const inputCount = Object.keys(input).length;

  return (
    <div
      className="tool-call-block"
      data-testid="desktop-tool-card"
      data-tool-status={visualState}
      data-tool-name={normalized}
    >
      <button
        type="button"
        className="tool-call-block-header"
        onClick={toggleOpen}
        aria-expanded={open}
      >
        <ToolIcon kind={kind} toolName={toolName} status={visualState} size={14} />
        <span className="tool-call-block-title" data-tool-category={getToolCategory(toolName)}>
          {desktopToolTitle(normalized)}
        </span>
        {summary.length > 0 && (
          <span className="tool-call-block-collapsed-summary" title={summary}>
            {summary}
          </span>
        )}
        {errorSummary && (
          <span className="tool-call-error-summary" title={errorSummary}>
            {errorSummary}
          </span>
        )}
        {visualState === 'running' && <span className="tool-call-block-running-hint">执行中…</span>}
        {visualState !== 'running' && durationMs != null && durationMs > 0 && (
          <span
            className="tool-call-block-elapsed"
            data-duration-tier={
              durationMs >= 10_000 ? 'slow' : durationMs >= 1_000 ? 'normal' : 'fast'
            }
          >
            {formatElapsed(durationMs)}
          </span>
        )}
        <span className="tool-call-block-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="tool-call-block-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {errorSummary && <FailureBanner reason={errorSummary} />}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px' }}>
              <DetailField label="动作" value={view.actionLabel} />
              {view.targetLabel.length > 0 && <DetailField label="目标" value={view.targetLabel} />}
            </div>

            {imageSource && <ToolCallImagePreview source={imageSource} />}
            {view.payloadKind === 'image' && !imageSource && view.status !== 'failed' && (
              <div className="tool-call-inline-empty">（未获取到截图）</div>
            )}

            {view.payloadKind === 'data' &&
              output !== undefined &&
              (outputNode.kind === 'none' ? (
                <div className="tool-call-block-output">
                  <ToolOutputPreview toolName={toolName} output={output} />
                </div>
              ) : (
                <DesktopOutputPreview node={outputNode} />
              ))}

            {inputCount > 0 && (
              <details className="tool-call-block-params" open>
                <summary>参数 ({inputCount})</summary>
                <div className="tool-call-block-params-body">
                  <ToolInputPreview toolName={toolName} input={input} kind={kind} />
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      <ToolApprovalActions
        approvalActions={approvalActions}
        permissionRequestId={pendingPermissionRequestId}
      />
    </div>
  );
}
