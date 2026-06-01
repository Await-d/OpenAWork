/**
 * TeamInitChecklist · 团队会话「初始化阶段」清单 UI（增强版）
 *
 * 渲染在 reception 空态卡片内（团队已就位下方）。能力：
 *   - 顶部进度条 + 完成计数 + 项目类型徽章 + 「全部执行 / 跳过初始化」
 *   - 每个步骤：状态图标（含 running 旋转）、AI 徽章、一句话说明、执行/跳过/重试
 *   - 完成步骤可展开「预览」：
 *       · 一级结构 → 目录 / 文件 chips
 *       · 项目记忆 → 各来源摘录（markdown）
 *       · 架构理解 → 架构摘要（markdown）
 *       · 工具绑定 → 各层 skill / mcp 明细
 *       · 记忆骨架 → markdown
 *   - 失败步骤行内红色错误 + 重试
 *
 * 约束：所有带副作用的步骤都需用户显式确认后才执行（方案要求）。
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { TeamInitState, TeamInitStep, TeamInitStepStatus } from '@openAwork/shared';
import MarkdownMessageContent from '../../../../components/chat/markdown/markdown-message-content.js';
import { useTeamInitChecklist } from './use-team-init-checklist.js';

export interface TeamInitChecklistProps {
  sessionId: string;
  sessionMetadata?: Record<string, unknown> | null;
}

// ─── 样式 ────────────────────────────────────────────────────────────────

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  marginTop: 4,
  padding: '16px 18px',
  borderRadius: 14,
  border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 4%, var(--bg-overlay))',
};

const HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
};

const TITLE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  fontWeight: 800,
  color: 'var(--fg-strong)',
};

const SUBTITLE_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

const PROGRESS_TRACK_STYLE: CSSProperties = {
  height: 5,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--border-default) 50%, transparent)',
  overflow: 'hidden',
};

const STEP_LIST_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const STEP_ROW_BASE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'var(--bg-overlay)',
  transition: 'border-color 150ms ease, background 150ms ease',
};

const STEP_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  justifyContent: 'space-between',
};

const BTN_STYLE: CSSProperties = {
  padding: '4px 12px',
  borderRadius: 7,
  border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  color: 'var(--accent)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const GHOST_BTN_STYLE: CSSProperties = {
  padding: '4px 12px',
  borderRadius: 7,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const PREVIEW_TOGGLE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
};

const PREVIEW_PANEL_STYLE: CSSProperties = {
  marginTop: 2,
  padding: '10px 12px',
  borderRadius: 9,
  background: 'color-mix(in srgb, var(--bg-base) 60%, var(--bg-overlay))',
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  fontSize: 11,
  color: 'var(--fg-default)',
  lineHeight: 1.6,
  maxHeight: 320,
  overflow: 'auto',
};

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'var(--bg-overlay)',
  fontSize: 10,
  color: 'var(--fg-default)',
};

const SPINNER_STYLE: CSSProperties = {
  width: 11,
  height: 11,
  border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  borderTopColor: 'var(--accent)',
  borderRadius: '50%',
  animation: 'team-empty-spin 0.8s linear infinite',
  display: 'inline-block',
  flexShrink: 0,
};

const DANGER = 'var(--danger, #e5484d)';

const STATUS_META: Record<TeamInitStepStatus, { label: string; color: string; icon: string }> = {
  proposed: { label: '待确认', color: 'var(--fg-muted)', icon: '○' },
  confirmed: { label: '已确认', color: 'var(--accent)', icon: '◔' },
  running: { label: '执行中', color: 'var(--accent)', icon: '◌' },
  done: { label: '已完成', color: 'var(--success)', icon: '●' },
  skipped: { label: '已跳过', color: 'var(--fg-muted)', icon: '–' },
  failed: { label: '失败', color: DANGER, icon: '✕' },
  not_applicable: { label: '不适用', color: 'var(--fg-muted)', icon: '·' },
};

const PROJECT_KIND_LABEL: Record<TeamInitState['projectKind'], string> = {
  empty: '空项目',
  existing: '已有项目',
  unknown: '未知',
};

// ─── 结果摘要 / 预览渲染 ────────────────────────────────────────────────────

function renderStepResultSummary(step: TeamInitStep): string | null {
  if (!step.result) return null;
  const r = step.result;
  switch (step.key) {
    case 'scan-shared-record':
      return `${r['isEmpty'] ? '空项目' : '已有内容'}${
        Array.isArray(r['matchedSignals']) && (r['matchedSignals'] as string[]).length > 0
          ? ` · 检测到 ${(r['matchedSignals'] as string[]).slice(0, 4).join(' / ')}`
          : ''
      }`;
    case 'read-project-level1':
      return `目录 ${r['directoryCount'] ?? 0} 个 · 文件 ${r['fileCount'] ?? 0} 个${
        typeof r['projectType'] === 'string' && r['projectType']
          ? ` · ${r['projectType'] as string}`
          : ''
      }${r['usedLlm'] ? ' · 已用 AI 解读' : ''}`;
    case 'extract-project-memory':
      return `读取记忆来源 ${r['foundCount'] ?? 0} 个${r['usedLlm'] ? ' · 已用 AI 提炼' : ''}`;
    case 'understand-architecture':
      return r['usedLlm'] ? '已用 AI 生成架构摘要' : '已生成架构摘要（启发式）';
    case 'bind-tools-per-layer':
      return `绑定 skill ${r['skillCount'] ?? 0} · MCP ${r['mcpCount'] ?? 0}${
        r['usedLlm'] ? ' · AI 按项目挑选' : ''
      }`;
    case 'scaffold-memory':
      return r['usedLlm'] ? '已用 AI 生成初始项目记忆骨架' : '已准备初始项目记忆骨架';
    default:
      return null;
  }
}

/** 该步是否有可展开的预览内容。 */
function stepHasPreview(step: TeamInitStep): boolean {
  if (step.status !== 'done' || !step.result) return false;
  const r = step.result;
  switch (step.key) {
    case 'scan-shared-record':
      return true;
    case 'read-project-level1':
      return (
        ((r['directories'] as string[]) ?? []).length > 0 ||
        ((r['files'] as string[]) ?? []).length > 0 ||
        (typeof r['interpretation'] === 'string' && (r['interpretation'] as string).length > 0)
      );
    case 'extract-project-memory':
      return ((r['excerpts'] as unknown[]) ?? []).length > 0;
    case 'understand-architecture':
      return typeof r['summary'] === 'string' && (r['summary'] as string).length > 0;
    case 'bind-tools-per-layer':
      return r['perLayer'] != null;
    case 'scaffold-memory':
      return typeof r['scaffold'] === 'string';
    default:
      return false;
  }
}

function ChipRow({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{emptyLabel}</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {items.map((item) => (
        <span key={item} style={CHIP_STYLE}>
          {item}
        </span>
      ))}
    </div>
  );
}

function PreviewSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--fg-muted)',
        margin: '6px 0 4px',
      }}
    >
      {children}
    </div>
  );
}

function renderStepPreview(step: TeamInitStep): ReactNode {
  const r = step.result ?? {};
  switch (step.key) {
    case 'scan-shared-record': {
      const signals = (r['matchedSignals'] as string[]) ?? [];
      return (
        <div>
          <PreviewSectionLabel>判定</PreviewSectionLabel>
          <div>
            项目类型：{r['isEmpty'] ? '空项目' : '已有内容'} · 顶层条目{' '}
            {String(r['topLevelEntryCount'] ?? 0)} 个 · 工作区历史会话{' '}
            {String(r['workspaceSessionCount'] ?? 0)} 个
          </div>
          <PreviewSectionLabel>命中标识</PreviewSectionLabel>
          <ChipRow items={signals} emptyLabel="未命中项目标识文件" />
        </div>
      );
    }
    case 'read-project-level1': {
      const dirs = (r['directories'] as string[]) ?? [];
      const files = (r['files'] as string[]) ?? [];
      const interpretation = (r['interpretation'] as string) ?? '';
      const techStack = (r['techStack'] as string[]) ?? [];
      const keyDirectories = (r['keyDirectories'] as Array<{ name: string; role: string }>) ?? [];
      return (
        <div>
          {interpretation ? (
            <>
              <PreviewSectionLabel>AI 解读</PreviewSectionLabel>
              <div style={{ color: 'var(--fg-strong)' }}>
                <MarkdownMessageContent content={interpretation} />
              </div>
            </>
          ) : null}
          {techStack.length > 0 ? (
            <>
              <PreviewSectionLabel>技术栈</PreviewSectionLabel>
              <ChipRow items={techStack} emptyLabel="（未识别）" />
            </>
          ) : null}
          {keyDirectories.length > 0 ? (
            <>
              <PreviewSectionLabel>关键目录职责</PreviewSectionLabel>
              <div style={{ display: 'grid', gap: 3 }}>
                {keyDirectories.map((kd) => (
                  <div key={kd.name} style={{ fontSize: 11 }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{kd.name}</span>
                    {kd.role ? (
                      <span style={{ color: 'var(--fg-muted)' }}> — {kd.role}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <PreviewSectionLabel>目录（{dirs.length}）</PreviewSectionLabel>
          <ChipRow items={dirs.map((d) => `${d}/`)} emptyLabel="（无）" />
          <PreviewSectionLabel>文件（{files.length}）</PreviewSectionLabel>
          <ChipRow items={files} emptyLabel="（无）" />
        </div>
      );
    }
    case 'extract-project-memory': {
      const excerpts = (r['excerpts'] as Array<{ label: string; excerpt: string }>) ?? [];
      const digest = (r['digest'] as string) ?? '';
      if (excerpts.length === 0) {
        return <div style={{ color: 'var(--fg-muted)' }}>未发现项目记忆文件。</div>;
      }
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {digest ? (
            <div>
              <PreviewSectionLabel>AI 提炼要点</PreviewSectionLabel>
              <div style={{ color: 'var(--fg-strong)' }}>
                <MarkdownMessageContent content={digest} />
              </div>
            </div>
          ) : null}
          {excerpts.map((ex) => (
            <div key={ex.label}>
              <PreviewSectionLabel>{ex.label}</PreviewSectionLabel>
              <div style={{ color: 'var(--fg-strong)' }}>
                <MarkdownMessageContent content={ex.excerpt} />
              </div>
            </div>
          ))}
        </div>
      );
    }
    case 'understand-architecture': {
      const summary = (r['summary'] as string) ?? '';
      return (
        <div style={{ color: 'var(--fg-strong)' }}>
          <MarkdownMessageContent content={summary} />
        </div>
      );
    }
    case 'bind-tools-per-layer': {
      const perLayer =
        (r['perLayer'] as Record<
          string,
          { skillIds: string[]; mcpServerIds: string[]; rationale: string | null }
        >) ?? {};
      const layers = Object.entries(perLayer);
      if (layers.length === 0) {
        return <div style={{ color: 'var(--fg-muted)' }}>无可绑定的工具。</div>;
      }
      return (
        <div style={{ display: 'grid', gap: 10 }}>
          {layers.map(([layer, binding]) => (
            <div key={layer}>
              <PreviewSectionLabel>{layer}</PreviewSectionLabel>
              {binding.rationale ? (
                <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 4 }}>
                  {binding.rationale}
                </div>
              ) : null}
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 10, color: 'var(--fg-muted)', minWidth: 34 }}>
                    skill
                  </span>
                  <ChipRow items={binding.skillIds} emptyLabel="无" />
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 10, color: 'var(--fg-muted)', minWidth: 34 }}>mcp</span>
                  <ChipRow items={binding.mcpServerIds} emptyLabel="无" />
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case 'scaffold-memory': {
      const scaffold = (r['scaffold'] as string) ?? '';
      return (
        <div style={{ color: 'var(--fg-strong)' }}>
          <MarkdownMessageContent content={scaffold} />
        </div>
      );
    }
    default:
      return null;
  }
}

// ─── 单步行 ────────────────────────────────────────────────────────────────

function StepRow({
  step,
  pendingStepKey,
  onConfirm,
  onSkip,
}: {
  step: TeamInitStep;
  pendingStepKey: string | null;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[step.status];
  const summary = renderStepResultSummary(step);
  const isRunning = step.status === 'running' || pendingStepKey === step.key;
  const isBusy = pendingStepKey !== null;
  const showActions = step.status === 'proposed' || step.status === 'failed';
  const hasPreview = stepHasPreview(step);

  const rowStyle: CSSProperties = {
    ...STEP_ROW_BASE,
    ...(step.status === 'failed'
      ? { borderColor: `color-mix(in srgb, ${DANGER} 45%, transparent)` }
      : {}),
    ...(step.status === 'done'
      ? { borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)' }
      : {}),
  };

  return (
    <div style={rowStyle}>
      <div style={STEP_HEADER_STYLE}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {isRunning ? (
            <span style={SPINNER_STYLE} aria-hidden />
          ) : (
            <span aria-hidden style={{ color: meta.color, fontSize: 11 }}>
              {meta.icon}
            </span>
          )}
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)' }}>
            {step.title}
          </span>
          {step.usesLlm ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                color: 'var(--accent)',
              }}
              title="该步骤会调用 AI，可能消耗额度"
            >
              AI
            </span>
          ) : null}
          <span style={{ fontSize: 10, color: meta.color }}>
            {isRunning ? '执行中…' : meta.label}
          </span>
        </div>
        {showActions ? (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              style={{
                ...BTN_STYLE,
                opacity: isBusy ? 0.5 : 1,
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
              disabled={isBusy}
              onClick={onConfirm}
            >
              {step.status === 'failed' ? '重试' : '执行'}
            </button>
            {step.status === 'proposed' ? (
              <button
                type="button"
                style={{
                  ...GHOST_BTN_STYLE,
                  opacity: isBusy ? 0.5 : 1,
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
                disabled={isBusy}
                onClick={onSkip}
              >
                跳过
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={SUBTITLE_STYLE}>{step.description}</div>

      {step.status === 'failed' && step.error ? (
        <div style={{ fontSize: 10, color: DANGER }}>错误：{step.error}</div>
      ) : null}

      {step.status === 'done' && (summary || hasPreview) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {summary ? (
            <span style={{ fontSize: 10, color: 'var(--fg-default)' }}>{summary}</span>
          ) : null}
          {hasPreview ? (
            <button
              type="button"
              style={PREVIEW_TOGGLE_STYLE}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              <span
                aria-hidden
                style={{
                  transition: 'transform 150ms',
                  transform: expanded ? 'rotate(90deg)' : 'none',
                }}
              >
                ▸
              </span>
              {expanded ? '收起预览' : '查看预览'}
            </button>
          ) : null}
        </div>
      ) : null}

      {expanded && hasPreview ? (
        <div style={PREVIEW_PANEL_STYLE}>{renderStepPreview(step)}</div>
      ) : null}
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────────

import type { TeamInitChecklistState } from './use-team-init-checklist.js';

/**
 * 展示体：纯受 props 驱动（不含 hook），供弹窗 / 内联两处复用同一份状态。
 */
export function TeamInitChecklistBody({ checklist }: { checklist: TeamInitChecklistState }) {
  const { teamInit, pendingStepKey, error, finished } = checklist;

  if (!teamInit || finished) {
    return null;
  }

  const actionableSteps = teamInit.steps.filter((step) => step.status !== 'not_applicable');
  const doneCount = actionableSteps.filter(
    (step) => step.status === 'done' || step.status === 'skipped',
  ).length;
  const total = actionableSteps.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const hasPending = actionableSteps.some((step) => step.status === 'proposed');
  const busy = pendingStepKey !== null;

  return (
    <div style={CARD_STYLE} role="region" aria-label="团队初始化清单">
      <div style={HEADER_ROW_STYLE}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={TITLE_STYLE}>
            <span aria-hidden>🧭</span>
            初始化准备
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)' }}>
              {doneCount}/{total}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 8px',
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                color: 'var(--accent)',
              }}
            >
              {PROJECT_KIND_LABEL[teamInit.projectKind]}
            </span>
          </div>
          <div style={{ ...SUBTITLE_STYLE, marginTop: 4 }}>
            团队会先了解项目再开始工作，每一步都由你确认后执行。也可以直接关闭并提需求，跳过准备。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {hasPending ? (
            <button
              type="button"
              style={{
                ...BTN_STYLE,
                opacity: busy ? 0.5 : 1,
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
              disabled={busy}
              onClick={() => void checklist.confirmAllPending()}
            >
              {pendingStepKey === 'all' ? '执行中…' : '全部执行'}
            </button>
          ) : null}
          <button
            type="button"
            style={{
              ...GHOST_BTN_STYLE,
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
            disabled={busy}
            onClick={() => void checklist.skipAll()}
          >
            跳过初始化
          </button>
        </div>
      </div>

      {/* 进度条 */}
      <div
        style={PROGRESS_TRACK_STYLE}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--accent)',
            borderRadius: 999,
            transition: 'width 250ms ease',
          }}
        />
      </div>

      {error ? (
        <div
          style={{
            fontSize: 11,
            color: DANGER,
            padding: '6px 10px',
            borderRadius: 8,
            background: `color-mix(in srgb, ${DANGER} 8%, transparent)`,
          }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div style={STEP_LIST_STYLE}>
        {actionableSteps.map((step) => (
          <StepRow
            key={step.key}
            step={step}
            pendingStepKey={pendingStepKey}
            onConfirm={() => void checklist.confirmStep(step.key)}
            onSkip={() => void checklist.skipStep(step.key)}
          />
        ))}
      </div>
    </div>
  );
}

export function TeamInitChecklist({ sessionId, sessionMetadata }: TeamInitChecklistProps) {
  const checklist = useTeamInitChecklist({ sessionId, sessionMetadata });
  return <TeamInitChecklistBody checklist={checklist} />;
}
