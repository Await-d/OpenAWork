import { StatusPill } from './primitives/index.js';
import { tokens } from './tokens.js';
import type { PillTone, StatusMeta, TaskSummaryData } from './tool-call-card-shared.js';

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        opacity: 0.55,
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform 160ms ease',
      }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function TaskMetaBadge({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | PillTone;
}) {
  const color = tone === 'default' ? 'muted' : tone;
  return <StatusPill label={label} color={color} data-tool-card-meta-label={color} />;
}

export function TaskMetaHighlights({
  agentType,
  readonly,
  executionStatus,
  executionTone,
}: {
  agentType?: string;
  readonly: boolean;
  executionStatus?: string;
  executionTone: PillTone;
}) {
  if (!agentType && !readonly && !executionStatus) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacing.xs - 1,
        flexWrap: 'wrap',
      }}
    >
      <TaskMetaBadge label="子代理" />
      {agentType && <TaskMetaBadge label={agentType} />}
      {readonly && <TaskMetaBadge label="只读" tone="success" />}
      {executionStatus && (
        <TaskMetaBadge label={`子任务 · ${executionStatus}`} tone={executionTone} />
      )}
    </div>
  );
}

export function CopyActionButton({
  state,
  onClick,
}: {
  state: 'idle' | 'copied' | 'failed';
  onClick: () => void;
}) {
  const copied = state === 'copied';
  const failed = state === 'failed';
  return (
    <button
      type="button"
      data-tool-card-copy="true"
      aria-label={copied ? '已复制工具内容' : failed ? '复制失败' : '复制工具内容'}
      title={copied ? '已复制工具内容' : failed ? '复制失败' : '复制工具内容'}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        appearance: 'none',
        border: `1px solid ${tokens.color.borderSubtle}`,
        background: copied
          ? `color-mix(in srgb, ${tokens.color.success} 14%, transparent)`
          : failed
            ? `color-mix(in srgb, ${tokens.color.danger} 14%, transparent)`
            : `color-mix(in srgb, ${tokens.color.surface} 84%, transparent)`,
        color: copied ? tokens.color.success : failed ? tokens.color.danger : tokens.color.muted,
        borderRadius: 999,
        padding: `${tokens.spacing.xxs}px ${tokens.spacing.sm}px`,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.4,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {copied ? '已复制' : failed ? '复制失败' : '复制'}
    </button>
  );
}

export function TaskSummaryCard({
  copyState,
  onCopy,
  open,
  statusMeta,
  summary,
  summaryData,
  toggle,
  toolKindLabel,
  agentType,
  readonly,
  childStatus,
  childStatusTone,
}: {
  copyState: 'idle' | 'copied' | 'failed';
  onCopy: () => void;
  open: boolean;
  statusMeta: StatusMeta;
  summary: string;
  summaryData: TaskSummaryData;
  toggle: () => void;
  toolKindLabel: string;
  agentType?: string;
  readonly: boolean;
  childStatus?: string;
  childStatusTone: PillTone;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: tokens.spacing.xs + 1,
        width: '100%',
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          appearance: 'none',
          border: 'none',
          background: 'transparent',
          padding: '1px 0',
          margin: 0,
          display: 'flex',
          alignItems: 'stretch',
          gap: tokens.spacing.xs + 1,
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'relative',
            width: 7,
            minWidth: 7,
            marginTop: tokens.spacing.xxs,
            height: 7,
            borderRadius: '50%',
            flexShrink: 0,
            background: statusMeta.dot,
            boxShadow:
              statusMeta.label === '执行中'
                ? `0 0 0 5px color-mix(in oklab, ${statusMeta.dot} 18%, transparent)`
                : 'none',
          }}
        />
        <div
          style={{
            minWidth: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.spacing.xxs,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: tokens.spacing.xs + 1,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                <TaskMetaBadge label={toolKindLabel} />
                {agentType && <TaskMetaBadge label={agentType} />}
                {readonly && <TaskMetaBadge label="只读" tone="success" />}
                {childStatus && (
                  <TaskMetaBadge label={`子任务 · ${childStatus}`} tone={childStatusTone} />
                )}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: tokens.color.text,
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}
              >
                {summaryData.title}
              </div>
              {summaryData.subtitle && (
                <div
                  style={{
                    fontSize: 11,
                    color: tokens.color.text,
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                  }}
                >
                  {summaryData.subtitle}
                </div>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 1,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: tokens.color.muted,
                }}
              >
                工具状态
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: tokens.spacing.xs + 1,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: statusMeta.color,
                }}
              >
                {statusMeta.label}
                <Chevron open={open} />
              </span>
            </div>
          </div>
          {summaryData.preview && (
            <div
              style={{
                fontSize: 11,
                color: tokens.color.muted,
                lineHeight: 1.55,
                wordBreak: 'break-word',
              }}
            >
              {summaryData.preview}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: tokens.spacing.xs - 1,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: tokens.color.muted,
                letterSpacing: '0.03em',
              }}
            >
              {summaryData.footer ?? '展开查看子代理任务详情'}
            </span>
            <span
              style={{
                fontSize: 10,
                color: tokens.color.muted,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={summary}
            >
              {summary}
            </span>
          </div>
        </div>
      </button>
      <CopyActionButton state={copyState} onClick={onCopy} />
    </div>
  );
}

export function ToolField({
  label,
  tone = 'default',
  value,
}: {
  label: string;
  tone?: 'default' | 'danger' | 'muted';
  value: string;
}) {
  const color = tone === 'danger' ? tokens.color.danger : tokens.color.text;
  const background =
    tone === 'danger'
      ? `color-mix(in srgb, ${tokens.color.danger} 18%, transparent)`
      : tone === 'muted'
        ? `color-mix(in srgb, ${tokens.color.surface} 84%, transparent)`
        : `color-mix(in srgb, ${tokens.color.surface2} 82%, transparent)`;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: tokens.color.muted,
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: `${tokens.spacing.sm - 2}px ${tokens.spacing.sm}px`,
          borderRadius: tokens.radius.sm + 2,
          background,
          color,
          fontSize: 11,
          lineHeight: 1.55,
          fontFamily:
            'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowX: 'auto',
          maxHeight: 200,
        }}
      >
        {value}
      </pre>
    </section>
  );
}
