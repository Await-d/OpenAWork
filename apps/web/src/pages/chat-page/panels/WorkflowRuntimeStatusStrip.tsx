import type { CSSProperties } from 'react';
import type { WorkflowRuntimeState } from '@openAwork/shared';
import type { SessionTask } from '@openAwork/web-client';

interface WorkflowRuntimeStatusStripProps {
  readonly runtime?: WorkflowRuntimeState | null;
  readonly tasks: readonly SessionTask[];
}

interface StartWorkGateSummary {
  readonly blocked: number;
  readonly confirmed: number;
  readonly pendingVerdict: number;
  readonly submittedClaims: number;
}

const STRIP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 'var(--spacing-2)',
  padding: 'var(--spacing-2) var(--spacing-4)',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'color-mix(in srgb, var(--bg-raised) 88%, var(--accent-subtle))',
  color: 'var(--fg-default)',
  minHeight: 44,
  overflow: 'hidden',
};

const TITLE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--spacing-2)',
  flexShrink: 0,
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  whiteSpace: 'nowrap',
};

const DOT_STYLE: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 'var(--radius-pill)',
  background: 'var(--accent)',
  boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent)',
  flexShrink: 0,
};

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--spacing-1)',
  flexShrink: 0,
  minHeight: 24,
  padding: '0 var(--spacing-2)',
  borderRadius: 'var(--radius-pill)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-muted)',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const CHIP_VALUE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontVariantNumeric: 'tabular-nums',
};

const WARNING_CHIP_STYLE: CSSProperties = {
  ...CHIP_STYLE,
  border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border-default))',
  background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-overlay))',
  color: 'var(--warning)',
};

const MODE_LABEL: Record<WorkflowRuntimeState['mode'], string> = {
  normal: '普通对话',
  planning: '规划中',
  execution: '执行中',
  ulw: 'ULW 循环',
};

const VERIFICATION_LABEL: Record<
  NonNullable<WorkflowRuntimeState['activeLoop']>['verificationStatus'],
  string
> = {
  none: '未要求验证',
  pending: '等待验证',
  passed: '验证通过',
  failed: '验证失败',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStartWorkGateSummary(tasks: readonly SessionTask[]): StartWorkGateSummary {
  let blocked = 0;
  let confirmed = 0;
  let pendingVerdict = 0;
  let submittedClaims = 0;

  for (const task of tasks) {
    const metadata = task.metadata;
    if (!isRecord(metadata)) {
      continue;
    }

    const gate = metadata.startWorkGate;
    if (!isRecord(gate)) {
      continue;
    }

    if (gate.completionBlocked === true) {
      blocked += 1;
    }

    if (gate.executorClaimStatus === 'submitted') {
      submittedClaims += 1;
    }

    if (gate.verifierVerdict === 'pending') {
      pendingVerdict += 1;
    }

    if (gate.verifierVerdict === 'confirmed') {
      confirmed += 1;
    }
  }

  return { blocked, confirmed, pendingVerdict, submittedClaims };
}

function shouldRenderStrip(
  runtime: WorkflowRuntimeState | null | undefined,
  gateSummary: StartWorkGateSummary,
): boolean {
  if (gateSummary.blocked > 0 || gateSummary.submittedClaims > 0) {
    return true;
  }

  if (!runtime) {
    return false;
  }

  return (
    runtime.mode !== 'normal' ||
    runtime.activePlan !== undefined ||
    runtime.activeLoop !== undefined ||
    runtime.evidence.status !== 'none' ||
    runtime.evidence.artifactRefs.length > 0
  );
}

function formatPlanLabel(runtime: WorkflowRuntimeState): string | null {
  const plan = runtime.activePlan;
  if (!plan) {
    return null;
  }

  const title = plan.title?.trim() || plan.path?.trim() || '未命名计划';
  return plan.progress ? `${title} · ${plan.progress}` : title;
}

function Chip({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <span style={CHIP_STYLE}>
      {label}
      <span style={CHIP_VALUE_STYLE}>{value}</span>
    </span>
  );
}

export function WorkflowRuntimeStatusStrip({ runtime, tasks }: WorkflowRuntimeStatusStripProps) {
  const gateSummary = readStartWorkGateSummary(tasks);

  if (!shouldRenderStrip(runtime, gateSummary)) {
    return null;
  }

  const modeLabel = runtime ? MODE_LABEL[runtime.mode] : '执行门禁';
  const planLabel = runtime ? formatPlanLabel(runtime) : null;
  const loop = runtime?.activeLoop;
  const evidenceCount = runtime?.evidence.artifactRefs.length ?? 0;

  return (
    <section aria-label="工作流运行状态" style={STRIP_STYLE}>
      <div style={TITLE_STYLE}>
        <span aria-hidden="true" style={DOT_STYLE} />
        <span>{modeLabel}</span>
      </div>
      {planLabel ? <Chip label="计划" value={planLabel} /> : null}
      {loop ? (
        <Chip
          label={loop.kind === 'ulw' ? '循环' : '循环'}
          value={`${loop.kind.toUpperCase()} · ${VERIFICATION_LABEL[loop.verificationStatus]}`}
        />
      ) : null}
      {loop?.taskId ? <Chip label="任务" value={loop.taskId} /> : null}
      {loop?.completionPromise ? <Chip label="完成承诺" value={loop.completionPromise} /> : null}
      {gateSummary.blocked > 0 || gateSummary.submittedClaims > 0 ? (
        <span style={WARNING_CHIP_STYLE}>
          Reviewer gate
          <span style={CHIP_VALUE_STYLE}>
            {gateSummary.submittedClaims} 已声明 / {gateSummary.pendingVerdict} 待审 /{' '}
            {gateSummary.confirmed} 确认 / {gateSummary.blocked} 阻塞
          </span>
        </span>
      ) : null}
      {runtime?.evidence.status === 'available' || evidenceCount > 0 ? (
        <Chip label="证据" value={`${evidenceCount} 个 artifact`} />
      ) : null}
      {runtime?.evidence.status === 'pending' ? <Chip label="证据" value="生成中" /> : null}
    </section>
  );
}
