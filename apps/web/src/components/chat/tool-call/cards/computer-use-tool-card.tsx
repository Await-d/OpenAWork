/**
 * `computer_use` 专用卡片：步骤时间线 + 最终截图（T-19 前端可视化）。
 *
 * 数据来源有三处，职责互不重叠：
 *   1. `output`（网关 JSON 字符串）：`summary` / `steps` / `history`，任务结束后是权威来源；
 *   2. `input._batchProgress`（`tool_progress` 事件注入的实时快照，与 batch 卡片同源）：
 *      运行中优先用它，能显示「当前正在执行哪一步」；
 *   3. tool result 的 `attachments`：最终截图（output 里的 base64 已被网关剥离）。
 *
 * 解析逻辑全部导出为纯函数，便于单测直接覆盖边界（非 JSON、缺字段、0-based 下标等）。
 */

import type { InputImageContent } from '@openAwork/shared';
import {
  resolveToolVisualStatus,
  type ToolCallCardProps,
  type ToolVisualStatus,
} from '@openAwork/shared-ui';
import { useMemo } from 'react';
import { useToolExpandDefault } from '../../../../stores/settings/use-tool-expand-default.js';
import { ToolIcon } from '../display/tool-icon.js';
import { ToolCallImagePreview } from '../io/ToolCallImagePreview.js';
import { extractErrorSummary } from '../shared/extract-error-summary.js';
import { formatElapsed } from '../shared/format.js';
import { ToolApprovalActions } from '../shared/tool-approval-actions.js';
import { resolveToolCallImageSource } from '../shared/tool-call-image-source.js';
import { useToolCallExpandState } from '../shared/use-tool-call-expand-state.js';

/* ── 视图模型 ── */

export type ComputerUseStepState = 'running' | 'completed' | 'failed' | 'pending' | 'skipped';

export interface ComputerUseStepView {
  /** 展示用步序号（从 1 开始）。 */
  index: number;
  /** 动作名，如 `click` / `type` / `scroll`。 */
  action: string;
  /** 该步的思考摘要，可能为空串（实时进度载荷不带 thought）。 */
  thought: string;
  state: ComputerUseStepState;
}

export interface ComputerUseOutputView {
  success?: boolean;
  /** 网关统计的总步数；缺失时调用方回退到 `history.length`。 */
  steps?: number;
  summary?: string;
  history: ComputerUseStepView[];
}

export interface ComputerUseProgressView {
  steps: ComputerUseStepView[];
  completedCount: number;
  totalCount: number;
}

const UNKNOWN_ACTION = '动作';

function readNonEmptyString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

/** 把任意 output 归一化成 `computer_use` 结果对象；非 JSON / 非对象返回 null。 */
function normalizeOutputRecord(output: unknown): Record<string, unknown> | null {
  if (typeof output === 'object' && output !== null && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    // 非 JSON（校验错误 / 抛出的异常文本）没有结构化信息可展示，由卡片其它分支兜底。
    return null;
  }
}

/**
 * 解析 `computer_use` 的 output。
 *
 * `history` 里的 `success` 直接决定该步的成败标记；条目结构异常时整条跳过而不是
 * 抛错——少渲染一行好过让整张卡片崩掉（原始 output 仍在别处可查）。
 */
export function parseComputerUseOutput(output: unknown): ComputerUseOutputView | null {
  const record = normalizeOutputRecord(output);
  if (!record) return null;

  const historyRaw = record['history'];
  const history: ComputerUseStepView[] = [];
  if (Array.isArray(historyRaw)) {
    historyRaw.forEach((entry, position) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return;
      const stepRecord = entry as Record<string, unknown>;
      const reportedStep = stepRecord['step'];
      const stepNumber =
        typeof reportedStep === 'number' && Number.isFinite(reportedStep) && reportedStep > 0
          ? Math.trunc(reportedStep)
          : position + 1;
      history.push({
        index: stepNumber,
        action: readNonEmptyString(stepRecord, ['action', 'tool']) || UNKNOWN_ACTION,
        thought: readNonEmptyString(stepRecord, ['thought']),
        state: stepRecord['success'] === true ? 'completed' : 'failed',
      });
    });
  }

  const summary = readNonEmptyString(record, ['summary']);
  const stepsRaw = record['steps'];
  const steps =
    typeof stepsRaw === 'number' && Number.isFinite(stepsRaw) && stepsRaw >= 0
      ? Math.trunc(stepsRaw)
      : undefined;
  const success = typeof record['success'] === 'boolean' ? record['success'] : undefined;

  return {
    ...(success !== undefined ? { success } : {}),
    ...(steps !== undefined ? { steps } : {}),
    ...(summary ? { summary } : {}),
    history,
  };
}

/** 把实时进度的 `status` / `isError` 归一化成步骤状态。 */
function readLiveStepState(record: Record<string, unknown>): ComputerUseStepState {
  if (record['isError'] === true) return 'failed';
  switch (typeof record['status'] === 'string' ? record['status'].trim().toLowerCase() : '') {
    case 'completed':
      return 'completed';
    case 'error':
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'skipped':
      return 'skipped';
    default:
      return 'pending';
  }
}

/**
 * 读取 `input._batchProgress`（`tool_progress` 事件的实时快照）。
 *
 * 载荷复用 batch 的子工具信封（`subTools[]`，下标 0-based）；GUI 步骤的
 * `action` / `thought` 若由网关额外携带则一并读取，缺失时退化为通用字段。
 */
export function readComputerUseProgress(
  input: Record<string, unknown>,
): ComputerUseProgressView | null {
  const progress = input['_batchProgress'];
  if (typeof progress !== 'object' || progress === null || Array.isArray(progress)) return null;
  const progressRecord = progress as Record<string, unknown>;

  const subTools = progressRecord['subTools'];
  if (!Array.isArray(subTools)) return null;

  const steps: ComputerUseStepView[] = subTools.flatMap((entry, position) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const stepRecord = entry as Record<string, unknown>;
    return [
      {
        index: position + 1,
        action: readNonEmptyString(stepRecord, ['action', 'tool']) || UNKNOWN_ACTION,
        thought: readNonEmptyString(stepRecord, ['thought', 'reasoning', 'summary']),
        state: readLiveStepState(stepRecord),
      },
    ];
  });

  const completedRaw = progressRecord['completedCount'];
  const totalRaw = progressRecord['totalCount'];
  const completedCount =
    typeof completedRaw === 'number' && Number.isFinite(completedRaw) && completedRaw > 0
      ? Math.trunc(completedRaw)
      : 0;
  const totalCount =
    typeof totalRaw === 'number' && Number.isFinite(totalRaw) && totalRaw > 0
      ? Math.trunc(totalRaw)
      : steps.length;

  return { steps, completedCount, totalCount };
}

/**
 * 选择要渲染的步骤列表：运行中优先实时进度（能标出当前步），结束后回退
 * `output.history`（带 thought，是权威结果）。
 */
export function buildComputerUseSteps(
  history: readonly ComputerUseStepView[],
  progress: ComputerUseProgressView | null,
  running: boolean,
): ComputerUseStepView[] {
  if (running && progress && progress.steps.length > 0) return progress.steps;
  if (history.length > 0) return [...history];
  return progress ? progress.steps : [];
}

/**
 * `computer_use` 的视觉状态。
 *
 * 不能直接用 `resolveToolVisualStatus`：GUI 任务跑不通时（模型门控不通过 /
 * 桌面桥未启用等）网关回的是 `isError: false` + `success: false`，只看 isError
 * 会把失败渲染成完成态，必须显式叠加 `success === false` 判定。
 */
export function resolveComputerUseVisualState(input: {
  isError?: boolean;
  output?: unknown;
  status?: ToolCallCardProps['status'];
}): ToolVisualStatus {
  if (input.isError === true) return 'failed';
  const parsed = parseComputerUseOutput(input.output);
  if (parsed?.success === false) return 'failed';
  return resolveToolVisualStatus({
    defaultStatus: 'running',
    isError: input.isError,
    output: input.output,
    status: input.status,
  });
}

/** 运行中需要高亮的那一步：最后一个尚未落定的步骤的位置；全落定时返回 null。 */
export function findCurrentStepPosition(steps: readonly ComputerUseStepView[]): number | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step && (step.state === 'running' || step.state === 'pending')) return i;
  }
  return null;
}

/* ── 样式（全部走 CSS 变量，禁止硬编码色值） ── */

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: 'var(--fg-muted)',
};

const PROGRESS_CHIP_STYLE: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 10,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--fg-muted)',
};

const CHEVRON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  width: 10,
  fontSize: 9,
  color: 'var(--fg-subtle)',
  textAlign: 'center',
};

const PLACEHOLDER_STYLE: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 4,
  background: 'var(--bg-overlay)',
  border: '1px dashed var(--border-default)',
  color: 'var(--fg-muted)',
  fontSize: 11,
  lineHeight: 1.5,
};

/* ── 子组件 ── */

/** 失败原因横幅（珊瑚色：danger 语义色）。 */
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

function StepRow({ step, current }: { step: ComputerUseStepView; current: boolean }) {
  const tone =
    step.state === 'failed'
      ? 'var(--danger)'
      : step.state === 'running'
        ? 'var(--accent)'
        : step.state === 'completed'
          ? 'var(--success)'
          : 'var(--fg-muted)';
  const marker = step.state === 'running' ? '◐' : step.state === 'failed' ? '✗' : '✓';
  const markerLabel =
    step.state === 'running'
      ? '进行中'
      : step.state === 'failed'
        ? '失败'
        : step.state === 'completed'
          ? '成功'
          : '待执行';

  return (
    <li
      data-cu-step={step.index}
      data-cu-step-state={step.state}
      aria-current={current ? 'step' : undefined}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '4px 8px',
        borderRadius: 4,
        // 当前步骤用 accent 弱底 + 左侧 accent 竖线高亮；其余行保持透明。
        background: current ? 'var(--accent-subtle)' : 'transparent',
        boxShadow: current ? 'inset 2px 0 0 var(--accent)' : undefined,
      }}
    >
      <span
        role="img"
        aria-label={markerLabel}
        style={{ flexShrink: 0, width: 10, fontSize: 11, fontWeight: 700, color: tone }}
      >
        {marker}
      </span>
      <span
        style={{
          flexShrink: 0,
          minWidth: 14,
          fontSize: 10,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--fg-subtle)',
        }}
      >
        {step.index}
      </span>
      <span
        title={step.action}
        style={{
          flexShrink: 0,
          maxWidth: '40%',
          fontSize: 11,
          fontWeight: 600,
          color: tone,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {step.action}
      </span>
      {step.thought.length > 0 && (
        <span
          title={step.thought}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            color: 'var(--fg-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {step.thought}
        </span>
      )}
    </li>
  );
}

/** 步骤时间线；空列表时给出占位（三态里的 empty 态）。 */
function StepTimeline({
  steps,
  currentPosition,
  emptyLabel,
}: {
  steps: readonly ComputerUseStepView[];
  /** 当前步在数组中的下标（用位置而非步号，容忍网关重复步号）。 */
  currentPosition: number | null;
  emptyLabel: string;
}) {
  if (steps.length === 0) {
    return (
      <div role="status" style={PLACEHOLDER_STYLE}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <ol
      aria-label="GUI 操作步骤"
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {steps.map((step, position) => (
        <StepRow
          key={`${position}-${step.index}`}
          step={step}
          current={position === currentPosition}
        />
      ))}
    </ol>
  );
}

/** 最终截图区：有附件时渲染缩略图（点击放大），没有时给出占位而非空白。 */
function ScreenshotSection({
  imageSource,
  running,
}: {
  imageSource: ReturnType<typeof resolveToolCallImageSource>;
  running: boolean;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={SECTION_LABEL_STYLE}>最终截图</span>
      {imageSource ? (
        <ToolCallImagePreview source={imageSource} />
      ) : (
        <div role="status" style={PLACEHOLDER_STYLE}>
          {running ? '任务结束后显示最终截图' : '本次任务未返回截图'}
        </div>
      )}
    </section>
  );
}

/* ── 卡片 ── */

export function ComputerUseToolCard({
  approvalActions,
  attachments,
  durationMs,
  input,
  isError,
  kind,
  output,
  pendingPermissionRequestId,
  status,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
  /** tool result 的附件通道；最终截图只从这里来。 */
  attachments?: readonly InputImageContent[];
  durationMs?: number;
  input: Record<string, unknown>;
  isError?: boolean;
  kind?: ToolCallCardProps['kind'];
  output?: unknown;
  pendingPermissionRequestId?: string;
  status?: ToolCallCardProps['status'];
}) {
  const visualState = useMemo(
    () => resolveComputerUseVisualState({ isError, output, status }),
    [isError, output, status],
  );
  // running / paused / pending 都还没落定：实时进度更贴近当前画面。
  const isLive = visualState === 'running' || visualState === 'paused' || visualState === 'pending';

  const parsed = useMemo(() => parseComputerUseOutput(output), [output]);
  const progress = useMemo(() => readComputerUseProgress(input), [input]);
  const steps = useMemo(
    () => buildComputerUseSteps(parsed?.history ?? [], progress, isLive),
    [parsed, progress, isLive],
  );
  const imageSource = useMemo(
    () => resolveToolCallImageSource('computer_use', input, output, attachments),
    [input, output, attachments],
  );

  const instruction = typeof input['instruction'] === 'string' ? input['instruction'].trim() : '';
  const failureReason =
    visualState === 'failed'
      ? parsed?.summary?.trim() || extractErrorSummary(output, isError)
      : null;

  const shouldExpandByDefault = useToolExpandDefault()('computer_use');
  const [open, toggleOpen] = useToolCallExpandState({
    shouldAutoExpand: shouldExpandByDefault,
    shouldExpandByDefault,
  });

  const currentPosition = isLive ? findCurrentStepPosition(steps) : null;
  const stepTotal = parsed?.steps ?? steps.length;
  const completedSteps = steps.filter((step) => step.state === 'completed').length;
  const progressLabel = isLive
    ? progress && progress.totalCount > 0
      ? `${progress.completedCount}/${progress.totalCount}`
      : steps.length > 0
        ? `${completedSteps}/${steps.length}`
        : '准备中…'
    : `共 ${stepTotal} 步`;
  const emptyStepsLabel =
    visualState === 'failed'
      ? '本次任务未执行任何步骤'
      : isLive
        ? '正在执行，等待第一步动作…'
        : '本次任务没有记录到执行步骤';

  return (
    <div className="tool-call-block" data-tool-status={visualState} data-tool-name="computer_use">
      {/* Header — 点击展开/折叠 */}
      <button
        type="button"
        className="tool-call-block-header"
        onClick={toggleOpen}
        aria-expanded={open}
      >
        <ToolIcon kind={kind} toolName="computer_use" status={visualState} size={14} />
        <span className="tool-call-block-title">computer_use</span>
        {instruction.length > 0 && (
          <span className="tool-call-block-collapsed-summary" title={instruction}>
            {instruction}
          </span>
        )}
        <span
          style={{
            ...PROGRESS_CHIP_STYLE,
            ...(isLive ? { color: 'var(--accent)' } : {}),
          }}
        >
          {progressLabel}
        </span>
        {failureReason && (
          <span className="tool-call-error-summary" title={failureReason}>
            {failureReason}
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
        <span aria-hidden style={CHEVRON_STYLE}>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="tool-call-block-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {failureReason && <FailureBanner reason={failureReason} />}

            {parsed?.summary && visualState !== 'failed' && (
              <p
                style={{
                  margin: 0,
                  fontSize: 11.5,
                  lineHeight: 1.55,
                  color: 'var(--fg-default)',
                }}
              >
                {parsed.summary}
              </p>
            )}

            {instruction.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={SECTION_LABEL_STYLE}>指令</span>
                <span style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--fg-default)' }}>
                  {instruction}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={SECTION_LABEL_STYLE}>执行步骤</span>
              <StepTimeline
                steps={steps}
                currentPosition={currentPosition}
                emptyLabel={emptyStepsLabel}
              />
            </div>

            <ScreenshotSection imageSource={imageSource} running={isLive} />
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
