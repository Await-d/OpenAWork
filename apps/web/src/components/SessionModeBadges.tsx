import { memo, useMemo, type CSSProperties } from 'react';
import { getSessionModeLabels } from '../utils/session-metadata.js';

interface SessionModeBadgesProps {
  compact?: boolean;
  maxItems?: number;
  metadataJson?: string;
}

const CLARIFY_BADGE_STYLE: CSSProperties = {
  background: 'rgba(245, 158, 11, 0.10)',
  color: 'rgb(245, 158, 11)',
};

const CODING_BADGE_STYLE: CSSProperties = {
  background: 'rgba(139, 92, 246, 0.12)',
  color: 'rgb(167, 139, 250)',
};

const PROGRAMMER_BADGE_STYLE: CSSProperties = {
  background: 'rgba(16, 185, 129, 0.12)',
  color: 'rgb(52, 211, 153)',
};

const YOLO_BADGE_STYLE: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--accent-text)',
};

const MODEL_BADGE_STYLE: CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-3)',
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
            ...(label === '澄清'
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
