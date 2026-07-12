import { memo, useMemo, type CSSProperties } from 'react';
import { getSessionModeLabels } from '../../../utils/session/session-metadata.js';

interface SessionModeBadgesProps {
  compact?: boolean;
  maxItems?: number;
  metadataJson?: string;
}

const CLARIFY_BADGE_STYLE: CSSProperties = {
  background: 'var(--warning-muted)',
  color: 'var(--warning)',
};

const CODING_BADGE_STYLE: CSSProperties = {
  background: 'var(--contrast-muted)',
  color: 'var(--contrast)',
};

const PROGRAMMER_BADGE_STYLE: CSSProperties = {
  background: 'var(--success-muted)',
  color: 'var(--success)',
};

const YOLO_BADGE_STYLE: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
};

const MODEL_BADGE_STYLE: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--fg-muted)',
};

function SessionModeBadgesInner({
  metadataJson,
  compact = false,
  maxItems = 3,
}: SessionModeBadgesProps) {
  const labels = useMemo(
    () => getSessionModeLabels(metadataJson).slice(0, maxItems),
    [maxItems, metadataJson],
  );
  if (labels.length === 0) {
    return null;
  }

  const badgeStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    maxWidth: compact ? 92 : 164,
    padding: compact ? '1px 6px' : '2px 8px',
    borderRadius: 999,
    fontSize: compact ? 9 : 10,
    fontWeight: 700,
    lineHeight: 1.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  return (
    <span
      title={labels.join(' · ')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'nowrap',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {labels.map((label) => (
        <span
          key={label}
          style={{
            ...badgeStyle,
            ...(label.startsWith('澄清')
              ? CLARIFY_BADGE_STYLE
              : label === '编程'
                ? CODING_BADGE_STYLE
                : label === '程序员'
                  ? PROGRAMMER_BADGE_STYLE
                  : label === 'YOLO'
                    ? YOLO_BADGE_STYLE
                    : MODEL_BADGE_STYLE),
          }}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

export const SessionModeBadges = memo(SessionModeBadgesInner);
SessionModeBadges.displayName = 'SessionModeBadges';
