import type { CSSProperties } from 'react';
import { ArtifactPreview } from '../tasks/ArtifactPreview.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type {
  LayerArtifactSelection,
  LayerSummaryPresentation,
} from './layer-summary-presentation.js';
import { resolveIncomingDialoguePreview } from './layer-dialogue-preview.js';

const SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
};

const RAIL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const STRIP_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  paddingBottom: 2,
};

const STRIP_CARD_STYLE: CSSProperties = {
  minWidth: 136,
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
};

const TIMELINE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const TIMELINE_ITEM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 34%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
};

const TWO_COLUMN_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
};

function renderDialogueField(input: {
  keyName: 'recommendedNextStep' | 'recommendedRole' | 'rewrittenIntent' | 'sourceIntent';
  presentation: LayerSummaryPresentation;
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

function ArtifactStack({ items }: { items: LayerArtifactSelection[] }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((item) => (
        <ArtifactPreview
          key={`${item.phase}:${item.artifact.title}`}
          title={item.artifact.title}
          content={item.artifact.content}
          phase={item.phase}
        />
      ))}
    </div>
  );
}

function Pm1SummaryPanel({
  artifactSequence,
  dialoguePreview,
  presentation,
}: {
  artifactSequence: LayerArtifactSelection[];
  dialoguePreview: ReturnType<typeof resolveIncomingDialoguePreview>;
  presentation: LayerSummaryPresentation;
}) {
  return (
    <div style={RAIL_STYLE}>
      {dialoguePreview ? (
        <div
          style={{
            ...SECTION_STYLE,
            borderColor: 'color-mix(in srgb, var(--aux) 24%, transparent)',
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
      ) : null}
      {artifactSequence.length > 0 ? (
        <div style={SECTION_STYLE}>
          <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>
            {presentation.artifactSectionTitle}
          </strong>
          <div style={STRIP_STYLE}>
            {artifactSequence.map((item) => (
              <div key={`${item.phase}-strip`} style={STRIP_CARD_STYLE}>
                <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>
                  {item.phase}
                </span>
                <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>
                  {item.artifact.title}
                </strong>
                <span style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                  规划链条中的 {item.phase} 产物
                </span>
              </div>
            ))}
          </div>
          <ArtifactStack items={artifactSequence} />
        </div>
      ) : null}
    </div>
  );
}

function Pm2SummaryPanel({
  artifactSequence,
  dialoguePreview,
  presentation,
}: {
  artifactSequence: LayerArtifactSelection[];
  dialoguePreview: ReturnType<typeof resolveIncomingDialoguePreview>;
  presentation: LayerSummaryPresentation;
}) {
  const reviewLead = artifactSequence[0] ?? null;
  const otherArtifacts = artifactSequence.slice(1);

  return (
    <div style={RAIL_STYLE}>
      {reviewLead ? (
        <div
          style={{
            ...SECTION_STYLE,
            borderColor: 'color-mix(in srgb, var(--chart-5) 30%, transparent)',
            background: 'color-mix(in srgb, var(--chart-5) 8%, var(--bg-overlay))',
          }}
        >
          <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>评审主结论</strong>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            {reviewLead.artifact.title}
          </span>
          <ArtifactPreview
            title={reviewLead.artifact.title}
            content={reviewLead.artifact.content}
            phase={reviewLead.phase}
          />
        </div>
      ) : null}
      {dialoguePreview ? (
        <div style={SECTION_STYLE}>
          <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>
            {presentation.dialogueSectionTitle}
          </strong>
          <div style={TIMELINE_STYLE}>
            {presentation.dialogueFieldOrder.map((keyName) => {
              const node = renderDialogueField({
                keyName,
                presentation,
                preview: dialoguePreview,
              });
              return node ? (
                <div key={keyName} style={TIMELINE_ITEM_STYLE}>
                  {node}
                </div>
              ) : null;
            })}
          </div>
        </div>
      ) : null}
      {otherArtifacts.length > 0 ? (
        <div style={SECTION_STYLE}>
          <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>评审依据</strong>
          <ArtifactStack items={otherArtifacts} />
        </div>
      ) : null}
    </div>
  );
}

function ExecutorSummaryPanel({
  artifactSequence,
  dialoguePreview,
  presentation,
}: {
  artifactSequence: LayerArtifactSelection[];
  dialoguePreview: ReturnType<typeof resolveIncomingDialoguePreview>;
  presentation: LayerSummaryPresentation;
}) {
  const identity = getRoleLayerIdentity('executor');
  const quickFields = [
    {
      label: presentation.dialogueFieldLabels.sourceIntent,
      value: dialoguePreview?.sourceIntent ?? '当前没有捕获到明确执行任务',
    },
    {
      label: presentation.dialogueFieldLabels.recommendedNextStep,
      value: dialoguePreview?.recommendedNextStep ?? '当前没有同步下一步动作',
    },
    {
      label: presentation.dialogueFieldLabels.rewrittenIntent,
      value: dialoguePreview?.rewrittenIntent ?? '当前没有补充执行上下文',
    },
    {
      label: presentation.dialogueFieldLabels.recommendedRole,
      value: dialoguePreview?.recommendedRole ?? '当前没有明确执行角色',
    },
  ];

  return (
    <div style={RAIL_STYLE}>
      <div
        style={{
          ...SECTION_STYLE,
          borderColor: `color-mix(in srgb, ${identity.color} 30%, transparent)`,
          background: `color-mix(in srgb, ${identity.color} 8%, var(--bg-overlay))`,
        }}
      >
        <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>
          {presentation.dialogueSectionTitle}
        </strong>
        <div style={TWO_COLUMN_STYLE}>
          {quickFields.map((field) => (
            <div key={field.label} style={STRIP_CARD_STYLE}>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>
                {field.label}
              </span>
              <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.6 }}>
                {field.value}
              </span>
            </div>
          ))}
        </div>
      </div>
      {artifactSequence.length > 0 ? (
        <div style={SECTION_STYLE}>
          <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>
            {presentation.artifactSectionTitle}
          </strong>
          <ArtifactStack items={artifactSequence} />
        </div>
      ) : null}
    </div>
  );
}

export function renderLayerSummaryContent(input: {
  artifactSequence: LayerArtifactSelection[];
  dialoguePreview: ReturnType<typeof resolveIncomingDialoguePreview>;
  presentation: LayerSummaryPresentation;
  roleLayer: string | null | undefined;
}) {
  switch (input.roleLayer) {
    case 'pm1':
      return (
        <Pm1SummaryPanel
          artifactSequence={input.artifactSequence}
          dialoguePreview={input.dialoguePreview}
          presentation={input.presentation}
        />
      );
    case 'pm2':
    case 'reviewer':
      return (
        <Pm2SummaryPanel
          artifactSequence={input.artifactSequence}
          dialoguePreview={input.dialoguePreview}
          presentation={input.presentation}
        />
      );
    case 'executor':
    case 'tester':
      return (
        <ExecutorSummaryPanel
          artifactSequence={input.artifactSequence}
          dialoguePreview={input.dialoguePreview}
          presentation={input.presentation}
        />
      );
    default:
      const fallbackDialoguePreview = input.dialoguePreview;
      return (
        <div style={RAIL_STYLE}>
          {fallbackDialoguePreview ? (
            <div style={SECTION_STYLE}>
              <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>
                {input.presentation.dialogueSectionTitle}
              </strong>
              {input.presentation.dialogueFieldOrder.map((keyName) =>
                renderDialogueField({
                  keyName,
                  presentation: input.presentation,
                  preview: fallbackDialoguePreview,
                }),
              )}
            </div>
          ) : null}
          {input.artifactSequence.length > 0 ? (
            <div style={SECTION_STYLE}>
              <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>
                {input.presentation.artifactSectionTitle}
              </strong>
              <ArtifactStack items={input.artifactSequence} />
            </div>
          ) : null}
        </div>
      );
  }
}
