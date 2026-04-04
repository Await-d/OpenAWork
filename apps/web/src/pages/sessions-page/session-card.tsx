import { memo, type CSSProperties } from 'react';
import { SessionModeBadges } from '../../components/SessionModeBadges.js';
import type { SessionRow } from './session-page-types.js';
import {
  isNestedInteractiveTarget,
  relativeTime,
  statusBadgeBg,
  statusBadgeFg,
  statusDotColor,
  statusLabel,
} from './session-page-utils.js';

export const SESSION_CARD_ACTION_BUTTON_STYLE: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 5,
  padding: '2px 7px',
  fontSize: 11,
  color: 'var(--text-3)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
};

export interface SessionCardProps {
  s: SessionRow;
  isDeleting: boolean;
  isSelected: boolean;
  isHovered: boolean;
  isRenaming: boolean;
  renameValue: string;
  smallBtn: CSSProperties;
  onHoverEnter: (sessionId: string, position?: { x: number; y: number }) => void;
  onHoverMove: (sessionId: string, position: { x: number; y: number }) => void;
  onHoverLeave: (sessionId: string) => void;
  onSelect: (sessionId: string) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: (sessionId: string) => void;
  onRenameCancel: () => void;
  onStartRename: (session: SessionRow) => void;
  onExport: (session: SessionRow) => void;
  onDelete: (sessionId: string) => void;
}

export const SessionCard = memo(function SessionCard({
  s,
  isDeleting,
  isSelected,
  isHovered,
  isRenaming,
  renameValue,
  smallBtn,
  onHoverEnter,
  onHoverMove,
  onHoverLeave,
  onSelect,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onStartRename,
  onExport,
  onDelete,
}: SessionCardProps) {
  return (
    <li
      data-session-id={s.id}
      data-session-state={s.state_status}
      className="session-item"
      onClick={(event) => {
        if (isNestedInteractiveTarget(event.target)) {
          return;
        }

        onSelect(s.id);
      }}
      onKeyDown={(event) => {
        if (isNestedInteractiveTarget(event.target)) {
          return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(s.id);
        }
      }}
      onMouseEnter={(event) => onHoverEnter(s.id, { x: event.clientX, y: event.clientY })}
      onMouseMove={(event) => onHoverMove(s.id, { x: event.clientX, y: event.clientY })}
      onMouseLeave={() => onHoverLeave(s.id)}
      onFocusCapture={() => onHoverEnter(s.id)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onHoverLeave(s.id);
        }
      }}
      style={{
        listStyle: 'none',
        background: isSelected
          ? 'var(--accent-muted)'
          : isHovered
            ? 'var(--surface-2)'
            : 'var(--surface)',
        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 9,
        padding: '0.625rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        transition: 'background 120ms, border-color 120ms',
        contentVisibility: 'auto',
        containIntrinsicSize: '58px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span
          data-session-running={s.state_status === 'running' ? 'true' : 'false'}
          aria-hidden="true"
          className={s.state_status === 'running' ? 'omo-session-running-dot' : undefined}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: statusDotColor(s.state_status),
            flexShrink: 0,
            boxShadow: s.state_status === 'running' ? '0 0 6px #22c55e' : 'none',
          }}
        />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {isRenaming ? (
            <input
              ref={(el) => el?.focus()}
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onRenameCommit(s.id);
                if (e.key === 'Escape') onRenameCancel();
              }}
              onBlur={() => onRenameCommit(s.id)}
              style={{
                flex: 1,
                background: 'var(--bg-2)',
                border: '1px solid var(--accent)',
                borderRadius: 4,
                padding: '2px 6px',
                color: 'var(--text)',
                fontSize: 12,
                outline: 'none',
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'none',
                border: 'none',
                padding: 0,
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text)',
              }}
            >
              <span
                title={s.title ?? s.id}
                style={{
                  display: 'block',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.title ?? (
                  <span style={{ color: 'var(--text-3)', fontFamily: 'monospace', fontSize: 11 }}>
                    {s.id.slice(0, 8)}…
                  </span>
                )}
              </span>
            </button>
          )}
          <div
            style={{
              position: 'relative',
              width: 216,
              height: 30,
              flexShrink: 0,
              marginLeft: 'auto',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 6,
                opacity: !isRenaming && !isHovered ? 1 : 0,
                transition: 'opacity 120ms ease-out',
                pointerEvents: 'none',
                willChange: 'opacity',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {relativeTime(s.updated_at)}
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 99,
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: statusBadgeBg(s.state_status),
                  color: statusBadgeFg(s.state_status),
                  fontWeight: 600,
                }}
              >
                {s.state_status === 'running' ? (
                  <span
                    aria-hidden="true"
                    className="omo-session-running-dot"
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: 'currentColor',
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                {statusLabel(s.state_status)}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  minWidth: 0,
                  maxWidth: 112,
                  overflow: 'hidden',
                }}
              >
                <SessionModeBadges compact metadataJson={s.metadata_json} />
              </span>
            </span>
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 6,
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 120ms ease-out',
                pointerEvents: isHovered ? 'auto' : 'none',
                willChange: 'opacity',
              }}
            >
              <button
                type="button"
                onClick={() => onStartRename(s)}
                style={smallBtn}
                tabIndex={isHovered ? 0 : -1}
              >
                重命名
              </button>
              <button
                type="button"
                onClick={() => onExport(s)}
                style={smallBtn}
                tabIndex={isHovered ? 0 : -1}
              >
                导出
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.id)}
                disabled={isDeleting}
                tabIndex={isHovered ? 0 : -1}
                style={{
                  ...smallBtn,
                  color: 'var(--danger)',
                  borderColor: 'rgba(239,68,68,0.3)',
                  opacity: isDeleting ? 0.5 : 1,
                  cursor: isDeleting ? 'wait' : smallBtn.cursor,
                }}
              >
                {isDeleting ? '删除中…' : '删除'}
              </button>
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}, areSessionCardPropsEqual);

function areSessionCardPropsEqual(previous: SessionCardProps, next: SessionCardProps): boolean {
  const renameValueUnchanged =
    (!previous.isRenaming && !next.isRenaming) || previous.renameValue === next.renameValue;

  return (
    previous.s === next.s &&
    previous.isDeleting === next.isDeleting &&
    previous.isSelected === next.isSelected &&
    previous.isHovered === next.isHovered &&
    previous.isRenaming === next.isRenaming &&
    renameValueUnchanged &&
    previous.smallBtn === next.smallBtn &&
    previous.onHoverEnter === next.onHoverEnter &&
    previous.onHoverMove === next.onHoverMove &&
    previous.onHoverLeave === next.onHoverLeave &&
    previous.onSelect === next.onSelect &&
    previous.onRenameChange === next.onRenameChange &&
    previous.onRenameCommit === next.onRenameCommit &&
    previous.onRenameCancel === next.onRenameCancel &&
    previous.onStartRename === next.onStartRename &&
    previous.onExport === next.onExport &&
    previous.onDelete === next.onDelete
  );
}
