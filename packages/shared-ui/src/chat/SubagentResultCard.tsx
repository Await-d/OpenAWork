import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type {
  SubagentResultItem,
  SubagentResultSection,
  SubagentResultSectionKind,
} from '@openAwork/shared';
import { color, font, radius, shadow, spacing } from '../tokens.js';

interface SectionTitle {
  label: string;
  accent: string;
}

/** 分节标题与语义色映射（token 语义：files=info，findings=contrast 数据高亮…）。 */
function sectionPresentation(kind: SubagentResultSectionKind): SectionTitle {
  switch (kind) {
    case 'files':
      return { label: '相关文件', accent: color.aux };
    case 'findings':
      return { label: '关键发现', accent: color.contrast };
    case 'answer':
      return { label: '回答', accent: color.accent };
    case 'next_steps':
      return { label: '后续步骤', accent: color.aux };
    case 'uncertainties':
      return { label: '待确认', accent: color.warning };
    default:
      return { label: '', accent: color.fgMuted };
  }
}

/** 文件路径条：等宽字体 + 路径 / 说明拆分展示。 */
function FileItem({ item }: { item: SubagentResultItem }) {
  const isPath = /^\s*\/\S/.test(item.text) || /^[a-z]+:\/\//i.test(item.text);
  return (
    <div
      style={{
        display: 'flex',
        gap: spacing[2],
        alignItems: 'baseline',
        padding: `${spacing[1]}px 0`,
      }}
    >
      <span
        style={{
          fontFamily: isPath ? font.mono : font.sans,
          fontSize: 12,
          fontWeight: 500,
          color: color.fgDefault,
          wordBreak: 'break-all',
          minWidth: 0,
        }}
      >
        {item.text}
      </span>
      {item.detail ? (
        <span style={{ fontSize: 12, color: color.fgMuted, minWidth: 0 }}>— {item.detail}</span>
      ) : null}
    </div>
  );
}

/** 列表分节（files / findings / next_steps / uncertainties / other-列表）。 */
function ItemSection({ section }: { section: SubagentResultSection }) {
  const presentation = sectionPresentation(section.kind);
  const items = section.items ?? [];
  if (items.length === 0) {
    return null;
  }
  return (
    <div style={{ marginBottom: spacing[3] }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing[1],
          marginBottom: spacing[1],
        }}
      >
        <span
          style={{
            width: 3,
            height: 12,
            borderRadius: radius.xs,
            background: presentation.accent,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: presentation.accent,
            textTransform: 'uppercase',
          }}
        >
          {presentation.label || section.title || '明细'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((item, index) => (
          <FileItem key={index} item={item} />
        ))}
      </div>
    </div>
  );
}

/** 正文分节（answer / raw / other-正文）。 */
function BodySection({ section }: { section: SubagentResultSection }) {
  const body = section.body?.trim() ?? '';
  if (body.length === 0) {
    return null;
  }
  const presentation = sectionPresentation(section.kind);
  const isRaw = section.kind === 'raw';
  return (
    <div style={{ marginBottom: isRaw ? 0 : spacing[3] }}>
      {isRaw ? null : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing[1],
            marginBottom: spacing[1],
          }}
        >
          <span
            style={{
              width: 3,
              height: 12,
              borderRadius: radius.xs,
              background: presentation.accent,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: presentation.accent,
              textTransform: 'uppercase',
            }}
          >
            {presentation.label}
          </span>
        </div>
      )}
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: color.fgDefault,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {body}
      </div>
    </div>
  );
}

export interface SubagentResultCardProps {
  /** 由 `parseSubagentResultBlocks` 解析出的分节（三端共用 SSOT）。 */
  sections: readonly SubagentResultSection[];
}

/**
 * 子代理结构化结果卡片：把 `<results>` 结果块（files / findings / answer /
 * next_steps / uncertainties）渲染为带语义色标栏的分节视图。
 *
 * 无结构化块时（全部为 raw 节）退化为纯正文视图，不做额外装饰——保证
 * 普通通知正文展示不受影响。
 */
export function SubagentResultCard({ sections }: SubagentResultCardProps) {
  const structured = useMemo(
    () => sections.some((section) => section.kind !== 'raw'),
    [sections],
  );
  const rawSections = useMemo(
    () => sections.filter((section) => section.kind === 'raw'),
    [sections],
  );

  const cardStyle: CSSProperties = {
    margin: 0,
    padding: `${spacing[3]}px ${spacing[4]}px`,
    background: color.bgOverlay,
    border: `1px solid ${color.borderDefault}`,
    borderRadius: radius.md,
    boxShadow: shadow.sm,
    fontFamily: font.sans,
  };

  if (!structured) {
    // 纯正文：按段落直接渲染，不套卡片装饰。
    return (
      <div
        data-component="subagent-result-card"
        data-structured={false}
        style={{
          padding: `${spacing[1]}px 0 ${spacing[2]}px`,
          fontSize: 13,
          lineHeight: 1.6,
          color: color.fgMuted,
          fontFamily: font.sans,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {rawSections.map((section, index) => (
          <BodySection key={index} section={section} />
        ))}
      </div>
    );
  }

  // 展示顺序：answer（主结论）→ files/findings（证据）→ next_steps / uncertainties → raw。
  const orderedSections = [
    ...sections.filter((section) => section.kind === 'answer'),
    ...sections.filter((section) => section.kind === 'files' || section.kind === 'findings'),
    ...sections.filter((section) => section.kind === 'next_steps' || section.kind === 'uncertainties'),
    ...sections.filter((section) => section.kind === 'other'),
    ...rawSections,
  ];

  return (
    <div data-component="subagent-result-card" data-structured style={cardStyle}>
      {orderedSections.map((section, index) => {
        if (section.items && section.items.length > 0) {
          return <ItemSection key={index} section={section} />;
        }
        if (section.body?.trim()) {
          return <BodySection key={index} section={section} />;
        }
        return null;
      })}
    </div>
  );
}
