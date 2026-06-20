import type { CSSProperties, ReactNode } from 'react';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import { resolveIncomingDialoguePreview } from './layer-dialogue-preview.js';

const PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
};

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
};

const GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
};

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
};

function RolePanelShell({
  children,
  eyebrow,
  helper,
  roleLayer,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  helper: string;
  roleLayer: string | null | undefined;
  title: string;
}) {
  const identity = getRoleLayerIdentity(roleLayer);
  return (
    <div
      style={{
        ...PANEL_STYLE,
        borderColor: `color-mix(in srgb, ${identity.color} 28%, transparent)`,
        background: `color-mix(in srgb, ${identity.color} 8%, var(--bg-overlay))`,
      }}
    >
      <div style={HEADER_STYLE}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: identity.color,
          }}
        >
          {eyebrow}
        </span>
        <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>{title}</strong>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{helper}</span>
      </div>
      {children}
    </div>
  );
}

function StatusCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div style={CARD_STYLE}>
      <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{label}</span>
      <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>{value}</strong>
    </div>
  );
}

export function LayerRoleHighlightsPanel({
  dialoguePreview,
  planArtifact,
  reviewArtifact,
  roleLayer,
  specArtifact,
  tasksArtifact,
}: {
  dialoguePreview: ReturnType<typeof resolveIncomingDialoguePreview>;
  planArtifact: { content: string; title: string } | null;
  reviewArtifact: { content: string; title: string } | null;
  roleLayer: string | null | undefined;
  specArtifact: { content: string; title: string } | null;
  tasksArtifact: { content: string; title: string } | null;
}) {
  switch (roleLayer) {
    case 'pm1':
      return (
        <RolePanelShell
          eyebrow="PM1 Planning"
          helper="规格、计划、任务三段闭环是否完整，是判断规划层是否真正交付的核心。"
          roleLayer={roleLayer}
          title="规划阶段"
        >
          <div style={GRID_STYLE}>
            <StatusCard label="规格" value={specArtifact ? '已形成' : '待补充'} />
            <StatusCard label="计划" value={planArtifact ? '已形成' : '待补充'} />
            <StatusCard label="任务" value={tasksArtifact ? '已拆解' : '未拆解'} />
          </div>
        </RolePanelShell>
      );
    case 'pm2':
    case 'reviewer':
      return (
        <RolePanelShell
          eyebrow="PM2 Review"
          helper="先看评审报告，再判断是否具备回退、重派或升级到用户的依据。"
          roleLayer={roleLayer}
          title="评审焦点"
        >
          <div style={GRID_STYLE}>
            <StatusCard label="评审报告" value={reviewArtifact ? '已输出' : '待生成'} />
            <StatusCard
              label="回退依据"
              value={tasksArtifact || planArtifact ? '已具备' : '不足'}
            />
            <StatusCard
              label="建议动作"
              value={dialoguePreview?.recommendedNextStep ? '已形成' : '待判断'}
            />
          </div>
        </RolePanelShell>
      );
    case 'executor':
    case 'tester':
      return (
        <RolePanelShell
          eyebrow="Executor Trace"
          helper="执行层重点不是计划文档，而是过程是否可追踪、工具是否跑完、产物是否落地。"
          roleLayer={roleLayer}
          title="执行观察"
        >
          <div style={GRID_STYLE}>
            <StatusCard label="任务线索" value={dialoguePreview?.sourceIntent ? '已捕获' : '缺失'} />
            <StatusCard
              label="执行产物"
              value={tasksArtifact || reviewArtifact ? '有输出' : '待输出'}
            />
            <StatusCard
              label="当前动作"
              value={dialoguePreview?.recommendedNextStep ? '已记录' : '待同步'}
            />
          </div>
        </RolePanelShell>
      );
    default:
      return null;
  }
}
