/**
 * TeamInitSummaryPanel · 初始化成果的常驻只读展示
 *
 * 背景：初始化弹窗 / 横幅在 phase 变为 completed / skipped 后就消失了，但初始化的
 * 产物（项目类型判定、一级结构、项目记忆摘录、架构摘要、各层工具绑定）是有长期
 * 查阅价值的。本面板在「概览」tab 里常驻展示这些成果——无论初始化是否已完成，
 * 只要会话有 teamInit 记录就能回看。
 *
 * 数据来源：直接调 web-client 的 getSessionInit（读 sessions.metadata_json.teamInit），
 * 不依赖会话对话视图的 sessionMetadata，因此切到概览 tab 也能独立加载。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createTeamClient } from '@openAwork/web-client';
import type { TeamInitState, TeamInitStep, TeamInitStepStatus } from '@openAwork/shared';
import MarkdownMessageContent from '../../../../../components/chat/markdown/markdown-message-content.js';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { useTeamNotificationStore } from '../../../../../stores/team/team-events.js';
import { PANEL_STYLE } from '../../shared/team-runtime-shared.js';

export interface TeamInitSummaryPanelProps {
  sessionId: string | null;
  /**
   * 'compact'（默认）：自带卡片外壳 + 标题，用于嵌入其它视图。
   * 'full'：去掉外壳标题（由外层 TabContainer 提供），用于独立「初始化」子 tab。
   */
  variant?: 'compact' | 'full';
}

const STATUS_META: Record<TeamInitStepStatus, { label: string; color: string; icon: string }> = {
  proposed: { label: '待确认', color: 'var(--fg-muted)', icon: '○' },
  confirmed: { label: '已确认', color: 'var(--accent)', icon: '◔' },
  running: { label: '执行中', color: 'var(--accent)', icon: '◌' },
  done: { label: '已完成', color: 'var(--success)', icon: '●' },
  skipped: { label: '已跳过', color: 'var(--fg-muted)', icon: '–' },
  failed: { label: '失败', color: 'var(--danger)', icon: '✕' },
  not_applicable: { label: '不适用', color: 'var(--fg-muted)', icon: '·' },
};

const PROJECT_KIND_LABEL: Record<TeamInitState['projectKind'], string> = {
  empty: '空项目',
  existing: '已有项目',
  unknown: '未知',
};

const PHASE_LABEL: Record<TeamInitState['phase'], { label: string; color: string }> = {
  proposed: { label: '待开始', color: 'var(--fg-muted)' },
  in_progress: { label: '进行中', color: 'var(--accent)' },
  completed: { label: '已完成', color: 'var(--success)' },
  skipped: { label: '已跳过', color: 'var(--warning)' },
};

const SECTION_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
  marginBottom: 4,
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

const SUBBLOCK_STYLE: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  background: 'var(--bg-overlay)',
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
};

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

function findStepResult(
  steps: TeamInitStep[],
  key: TeamInitStep['key'],
): Record<string, unknown> | null {
  const step = steps.find((s) => s.key === key);
  return (step?.result as Record<string, unknown> | undefined) ?? null;
}

export function TeamInitSummaryPanel({
  sessionId,
  variant = 'compact',
}: TeamInitSummaryPanelProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const client = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);

  const [teamInit, setTeamInit] = useState<TeamInitState | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  // 记录「当前已加载数据所属的 sessionId」，切换会话时立即作废旧数据，
  // 避免异步 fetch 未回来前面板闪现上一条会话的初始化成果。
  const loadedSessionRef = useRef<string | null>(null);

  // 订阅 session.init.changed：自动初始化 / 手动执行后实时刷新本面板。
  useEffect(() => {
    if (!sessionId) return undefined;
    let lastSeen = 0;
    const unsub = useTeamNotificationStore.subscribe((state) => {
      const last = state.events[state.events.length - 1];
      if (!last || last.timestamp <= lastSeen) return;
      lastSeen = last.timestamp;
      if (last.sessionId === sessionId && last.type === 'session.init.changed') {
        setRefreshTick((v) => v + 1);
      }
    });
    return () => unsub();
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    if (!accessToken || !sessionId) {
      loadedSessionRef.current = null;
      setTeamInit(null);
      return () => {
        cancelled = true;
      };
    }
    // 切到新会话：先作废旧数据（清空），再拉取，杜绝陈旧闪现。
    if (loadedSessionRef.current !== sessionId) {
      setTeamInit(null);
    }
    setLoading(true);
    void (async () => {
      const result = await client.getSessionInit(accessToken, sessionId);
      if (cancelled) return;
      loadedSessionRef.current = sessionId;
      setTeamInit(result.teamInit ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, client, sessionId, refreshTick]);

  if (!sessionId) {
    return variant === 'full' ? (
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '8px 2px' }}>
        请先在左侧选择一个团队会话，查看其初始化成果。
      </div>
    ) : null;
  }
  // 无初始化记录（非团队会话 / 老会话 / 尚未加载）：
  // - compact：返回 null，避免占位噪音
  // - full（独立 tab）：给一句空态说明，避免空白 tab
  if (!teamInit) {
    return variant === 'full' ? (
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '8px 2px' }}>
        {loading ? '加载初始化成果中…' : '当前会话没有初始化记录。'}
      </div>
    ) : null;
  }

  const phaseMeta = teamInit ? PHASE_LABEL[teamInit.phase] : null;
  const actionableSteps = teamInit
    ? teamInit.steps.filter((s) => s.status !== 'not_applicable')
    : [];
  const doneCount = actionableSteps.filter(
    (s) => s.status === 'done' || s.status === 'skipped',
  ).length;

  const level1 = teamInit ? findStepResult(teamInit.steps, 'read-project-level1') : null;
  const memoryExcerpts = teamInit
    ? ((findStepResult(teamInit.steps, 'extract-project-memory')?.['excerpts'] as
        | Array<{ label: string; excerpt: string }>
        | undefined) ?? [])
    : [];
  const bindResult = teamInit ? findStepResult(teamInit.steps, 'bind-tools-per-layer') : null;
  const perLayer =
    (bindResult?.['perLayer'] as
      | Record<string, { skillIds: string[]; mcpServerIds: string[]; rationale: string | null }>
      | undefined) ?? {};
  const deferredEmptyInit =
    teamInit.projectKind === 'empty' &&
    teamInit.steps.some(
      (step) =>
        (step.key === 'bind-tools-per-layer' || step.key === 'scaffold-memory') &&
        step.status === 'not_applicable',
    );

  const sections: ReactNode[] = [];

  if (deferredEmptyInit) {
    sections.push(
      <div key="deferred-empty">
        <div style={SECTION_LABEL_STYLE}>空项目初始化策略</div>
        <div style={{ ...SUBBLOCK_STYLE, color: 'var(--fg-default)' }}>
          当前工作区尚无项目内容，已暂缓工具绑定与项目记忆生成；收到首个明确需求后会按目标自动初始化。
        </div>
      </div>,
    );
  }

  if (teamInit?.bindings.architectureSummary) {
    sections.push(
      <div key="arch">
        <div style={SECTION_LABEL_STYLE}>项目架构摘要</div>
        <div style={{ ...SUBBLOCK_STYLE, color: 'var(--fg-strong)' }}>
          <MarkdownMessageContent content={teamInit.bindings.architectureSummary} />
        </div>
      </div>,
    );
  }

  if (
    level1 &&
    ((level1['directories'] as string[])?.length || (level1['files'] as string[])?.length)
  ) {
    sections.push(
      <div key="level1">
        <div style={SECTION_LABEL_STYLE}>项目一级结构</div>
        <div style={{ ...SUBBLOCK_STYLE, display: 'grid', gap: 6 }}>
          <ChipRow
            items={((level1['directories'] as string[]) ?? []).map((d) => `${d}/`)}
            emptyLabel="（无目录）"
          />
          <ChipRow items={(level1['files'] as string[]) ?? []} emptyLabel="（无文件）" />
        </div>
      </div>,
    );
  }

  if (memoryExcerpts.length > 0) {
    sections.push(
      <div key="memory">
        <div style={SECTION_LABEL_STYLE}>项目记忆</div>
        <div style={{ ...SUBBLOCK_STYLE, display: 'grid', gap: 8 }}>
          {memoryExcerpts.map((ex) => (
            <div key={ex.label}>
              <div
                style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', marginBottom: 2 }}
              >
                {ex.label}
              </div>
              <div style={{ color: 'var(--fg-strong)' }}>
                <MarkdownMessageContent content={ex.excerpt} />
              </div>
            </div>
          ))}
        </div>
      </div>,
    );
  }

  const layerEntries = Object.entries(perLayer);
  if (layerEntries.length > 0) {
    sections.push(
      <div key="bindings">
        <div style={SECTION_LABEL_STYLE}>
          {bindResult?.['mode'] === 'goal-driven' ? '按首个目标绑定工具' : '各层工具绑定'}
        </div>
        <div style={{ ...SUBBLOCK_STYLE, display: 'grid', gap: 10 }}>
          {layerEntries.map(([layer, binding]) => (
            <div key={layer}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-strong)' }}>
                {layer}
              </div>
              {binding.rationale ? (
                <div style={{ fontSize: 10, color: 'var(--fg-muted)', margin: '2px 0 4px' }}>
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
      </div>,
    );
  }

  const isFull = variant === 'full';
  const wrapperStyle: CSSProperties = isFull
    ? { display: 'grid', gap: 10 }
    : { ...PANEL_STYLE, padding: '12px 14px', borderRadius: 10, display: 'grid', gap: 10 };

  return (
    <div style={wrapperStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!isFull ? (
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--fg-strong)' }}>
            🧭 初始化成果
          </span>
        ) : null}
        {teamInit ? (
          <>
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
            {phaseMeta ? (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 8px',
                  borderRadius: 999,
                  background: `color-mix(in srgb, ${phaseMeta.color} 14%, transparent)`,
                  color: phaseMeta.color,
                }}
              >
                {phaseMeta.label} · {doneCount}/{actionableSteps.length}
              </span>
            ) : null}
          </>
        ) : null}
        {loading ? <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>加载中…</span> : null}
      </div>

      {/* 步骤状态一览 */}
      {actionableSteps.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {actionableSteps.map((step) => {
            const meta = STATUS_META[step.status];
            return (
              <span
                key={step.key}
                style={{
                  ...CHIP_STYLE,
                  borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)`,
                }}
                title={step.error ?? step.description}
              >
                <span aria-hidden style={{ color: meta.color }}>
                  {meta.icon}
                </span>
                {step.title}
              </span>
            );
          })}
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>{sections}</div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {teamInit.projectKind === 'empty'
            ? '空项目尚未产出项目化初始化成果；收到首个明确需求后会按目标自动初始化。'
            : '初始化尚未产出可展示的成果（步骤未执行或已跳过）。'}
        </div>
      )}
    </div>
  );
}
