import type { CSSProperties } from 'react';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type { LayerConversationRow } from './layered-conversation-model.js';
import { TEAM_LAYER_LABELS } from './layered-conversation-model.js';
import { resolveIncomingDialoguePreview } from './layer-dialogue-preview.js';
import {
  getLayerSummaryPresentation,
  pickLayerArtifactSequence,
} from './layer-summary-presentation.js';
import { LayerRoleHighlightsPanel } from './LayerSummaryRolePanels.js';
import { renderLayerSummaryContent } from './LayerSummaryPanels.js';

const SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
};

const BADGE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 42%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 700,
};

const ROOT_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '14px',
};

const LENS_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'color-mix(in srgb, var(--accent) 24%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
};

interface LayerSummarySidebarProps {
  artifactError: string | null;
  artifactLoading: boolean;
  dialoguePreview: ReturnType<typeof resolveIncomingDialoguePreview>;
  row: Pick<LayerConversationRow, 'detail' | 'roleLayer' | 'sessionId' | 'state' | 'displayName' | 'personaKey'>;
  planArtifact: { content: string; title: string } | null;
  reviewArtifact: { content: string; title: string } | null;
  sessionLabel?: string | null;
  specArtifact: { content: string; title: string } | null;
  summaryTitle?: string | null;
  tasksArtifact: { content: string; title: string } | null;
}

function SummaryHero({
  identityCodeLabel,
  icon,
  note,
  title,
  toneColor,
}: {
  identityCodeLabel: string;
  icon: string;
  note: string;
  title: string;
  toneColor: string;
}) {
  return (
    <div
      style={{
        ...HERO_STYLE,
        borderColor: `color-mix(in srgb, ${toneColor} 28%, transparent)`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${toneColor} 10%, var(--bg-overlay)), color-mix(in srgb, var(--bg-overlay) 84%, var(--bg-base)))`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-hidden
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: `color-mix(in srgb, ${toneColor} 18%, transparent)`,
            border: `1px solid color-mix(in srgb, ${toneColor} 28%, transparent)`,
            fontSize: 16,
          }}
        >
          {icon}
        </span>
        <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>{title}</strong>
          <span style={{ fontSize: 11, color: toneColor, fontWeight: 700 }}>{identityCodeLabel}</span>
        </div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.6 }}>{note}</span>
    </div>
  );
}

function SummaryBadges({
  labels,
}: {
  labels: string[];
}) {
  return (
    <div style={BADGE_ROW_STYLE}>
      {labels.map((label) => (
        <span key={label} style={BADGE_STYLE}>
          {label}
        </span>
      ))}
    </div>
  );
}

function SummaryTextBlock({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <div style={{ ...SECTION_STYLE, color: 'var(--fg-default)', fontSize: 11, lineHeight: 1.6 }}>
      <strong style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--fg-strong)' }}>
        {title}
      </strong>
      {body}
    </div>
  );
}

function PrimaryLensBlock({
  description,
  label,
  toneColor,
}: {
  description: string;
  label: string;
  toneColor: string;
}) {
  return (
    <div
      style={{
        ...LENS_STYLE,
        borderColor: `color-mix(in srgb, ${toneColor} 28%, transparent)`,
        background: `color-mix(in srgb, ${toneColor} 8%, transparent)`,
      }}
    >
      <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-strong)' }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: toneColor,
            display: 'inline-block',
          }}
        />
        本层重点 · {label}
      </strong>
      <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.6 }}>
        {description}
      </span>
    </div>
  );
}

function DialogueSection({
  dialoguePreview,
  presentation,
}: {
  dialoguePreview: NonNullable<ReturnType<typeof resolveIncomingDialoguePreview>>;
  presentation: ReturnType<typeof getLayerSummaryPresentation>;
}) {
  return (
    <div
      style={{
        ...SECTION_STYLE,
        border: '1px solid color-mix(in srgb, var(--aux) 24%, transparent)',
        background: 'color-mix(in srgb, var(--aux) 8%, transparent)',
      }}
    >
      <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>
        {presentation.dialogueSectionTitle}
      </strong>
      {presentation.dialogueFieldOrder.map((keyName) =>
        renderDialogueField({
          keyName,
          presentation,
          preview: dialoguePreview,
        }),
      )}
    </div>
  );
}

const HERO_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '12px 14px',
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'color-mix(in srgb, var(--border-default) 36%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 96%, var(--bg-base)), color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base)))',
};

function renderDialogueField(input: {
  keyName: 'recommendedNextStep' | 'recommendedRole' | 'rewrittenIntent' | 'sourceIntent';
  presentation: ReturnType<typeof getLayerSummaryPresentation>;
  preview: NonNullable<ReturnType<typeof resolveIncomingDialoguePreview>>;
}) {
  const value = input.preview[input.keyName];
  if (!value) {
    return null;
  }

  const label =
    input.keyName === 'sourceIntent'
      ? input.presentation.dialogueFieldLabels.sourceIntent
      : input.keyName === 'rewrittenIntent'
        ? input.presentation.dialogueFieldLabels.rewrittenIntent
        : input.keyName === 'recommendedRole'
          ? input.presentation.dialogueFieldLabels.recommendedRole
          : input.presentation.dialogueFieldLabels.recommendedNextStep;

  return (
    <div key={input.keyName} style={{ display: 'grid', gap: 3 }}>
      <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.6 }}>{value}</span>
    </div>
  );
}

function renderRoleHighlightsBlock(input: {
  dialoguePreview: ReturnType<typeof resolveIncomingDialoguePreview>;
  planArtifact: { content: string; title: string } | null;
  reviewArtifact: { content: string; title: string } | null;
  roleLayer: string | null | undefined;
  specArtifact: { content: string; title: string } | null;
  tasksArtifact: { content: string; title: string } | null;
}) {
  switch (input.roleLayer) {
    case 'pm1':
      return (
        <LayerRoleHighlightsPanel
          dialoguePreview={input.dialoguePreview}
          planArtifact={input.planArtifact}
          reviewArtifact={input.reviewArtifact}
          roleLayer={input.roleLayer}
          specArtifact={input.specArtifact}
          tasksArtifact={input.tasksArtifact}
        />
      );
    case 'pm2':
    case 'reviewer':
      return (
        <LayerRoleHighlightsPanel
          dialoguePreview={input.dialoguePreview}
          planArtifact={input.planArtifact}
          reviewArtifact={input.reviewArtifact}
          roleLayer={input.roleLayer}
          specArtifact={input.specArtifact}
          tasksArtifact={input.tasksArtifact}
        />
      );
    case 'executor':
    case 'tester':
      return (
        <LayerRoleHighlightsPanel
          dialoguePreview={input.dialoguePreview}
          planArtifact={input.planArtifact}
          reviewArtifact={input.reviewArtifact}
          roleLayer={input.roleLayer}
          specArtifact={input.specArtifact}
          tasksArtifact={input.tasksArtifact}
        />
      );
    default:
      return null;
  }
}

export function LayerSummarySidebar({
  artifactError,
  artifactLoading,
  dialoguePreview,
  row,
  planArtifact,
  reviewArtifact,
  sessionLabel,
  specArtifact,
  summaryTitle,
  tasksArtifact,
}: LayerSummarySidebarProps) {
  const presentation = getLayerSummaryPresentation(row.roleLayer);
  const identity = getRoleLayerIdentity(row.roleLayer);
  const artifactSequence = pickLayerArtifactSequence({
    planArtifact,
    reviewArtifact,
    roleLayer: row.roleLayer,
    specArtifact,
    tasksArtifact,
  });
  const highlightsBlock = renderRoleHighlightsBlock({
    dialoguePreview,
    planArtifact,
    reviewArtifact,
    roleLayer: row.roleLayer,
    specArtifact,
    tasksArtifact,
  });
  const summaryBlock = (
    <SummaryTextBlock body={row.detail} title={summaryTitle ?? presentation.summaryCardTitle} />
  );
  const artifactBlock =
    artifactLoading ? (
      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>正在加载当前层级产物摘要…</div>
    ) : artifactSequence.length > 0 || dialoguePreview ? (
      renderLayerSummaryContent({
        artifactSequence,
        dialoguePreview,
        presentation,
        roleLayer: row.roleLayer,
      })
    ) : (
      <div
        style={{
          padding: '10px 12px',
          borderRadius: 10,
          border: '1px dashed color-mix(in srgb, var(--border-default) 48%, transparent)',
          color: 'var(--fg-muted)',
          fontSize: 11,
          lineHeight: 1.6,
        }}
      >
        {presentation.emptyMessage}
      </div>
    );
  const orderedSections = presentation.sectionOrder
    .map((section, index) => {
      switch (section) {
        case 'summary':
          return summaryBlock ? <div key={`summary-${index}`}>{summaryBlock}</div> : null;
        case 'dialogue':
          return dialoguePreview && row.roleLayer === 'reception' ? (
            <div key={`dialogue-${index}`}>
              <DialogueSection dialoguePreview={dialoguePreview} presentation={presentation} />
            </div>
          ) : null;
        case 'artifact':
          return artifactBlock ? <div key={`artifact-${index}`}>{artifactBlock}</div> : null;
      }
    })
    .filter((section): section is Exclude<typeof section, null> => section !== null);

  return (
    <div style={ROOT_STYLE}>
      <SummaryHero
        icon={identity.icon}
        identityCodeLabel={`${TEAM_LAYER_LABELS[row.roleLayer]} · ${
          identity.code ? `层级 ${identity.code}` : '团队层'
        }${row.displayName ? ` · ${row.displayName}` : ''}`}
        note={presentation.note}
        title={row.displayName ? `${presentation.title} · ${row.displayName}` : presentation.title}
        toneColor={identity.color}
      />
      <PrimaryLensBlock
        description={presentation.primaryLensDescription}
        label={presentation.primaryLensLabel}
        toneColor={identity.color}
      />
      <SummaryBadges
        labels={[
          TEAM_LAYER_LABELS[row.roleLayer],
          row.state,
          ...(row.displayName ? [row.displayName] : []),
          ...(row.personaKey ? [row.personaKey] : []),
          `session · ${(sessionLabel ?? row.sessionId).slice(0, 8)}`,
          ...(reviewArtifact ? ['review'] : []),
          ...(specArtifact ? ['spec'] : []),
          ...(planArtifact ? ['plan'] : []),
          ...(tasksArtifact ? ['tasks'] : []),
        ]}
      />
      {highlightsBlock}
      {orderedSections}
      {artifactError ? (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay))',
            color: 'var(--danger)',
            fontSize: 11,
          }}
        >
          {artifactError}
        </div>
      ) : null}
    </div>
  );
}
