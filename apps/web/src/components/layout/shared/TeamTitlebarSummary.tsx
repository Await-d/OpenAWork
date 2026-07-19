import { useEffect, useMemo, useState } from 'react';

type TitlebarDensity = 'mobile' | 'tablet' | 'desktop';

const MOBILE_TITLEBAR_QUERY = '(max-width: 520px)';
const TABLET_TITLEBAR_QUERY = '(max-width: 1023px)';

interface TeamTitlebarSummaryProps {
  readonly pathname: string;
}

function getWorkspaceLabel(pathname: string): string {
  const workspaceId = pathname.match(/^\/team\/([^/?#]+)/)?.[1];
  if (!workspaceId) {
    return '全部工作区';
  }

  try {
    return decodeURIComponent(workspaceId);
  } catch {
    return workspaceId;
  }
}

function getMobileWorkspaceLabel(pathname: string): string {
  const workspaceId = pathname.match(/^\/team\/([^/?#]+)/)?.[1];
  if (!workspaceId) {
    return '全部';
  }

  try {
    const decoded = decodeURIComponent(workspaceId);
    return decoded.length > 6 ? `${decoded.slice(0, 6)}…` : decoded;
  } catch {
    return workspaceId.length > 6 ? `${workspaceId.slice(0, 6)}…` : workspaceId;
  }
}

function getTitlebarDensity(): TitlebarDensity {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'desktop';
  }

  if (window.matchMedia(MOBILE_TITLEBAR_QUERY).matches) {
    return 'mobile';
  }

  if (window.matchMedia(TABLET_TITLEBAR_QUERY).matches) {
    return 'tablet';
  }

  return 'desktop';
}

function useTitlebarDensity(): TitlebarDensity {
  const [density, setDensity] = useState<TitlebarDensity>(() => getTitlebarDensity());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mobileMedia = window.matchMedia(MOBILE_TITLEBAR_QUERY);
    const tabletMedia = window.matchMedia(TABLET_TITLEBAR_QUERY);
    const update = () => setDensity(getTitlebarDensity());
    update();
    mobileMedia.addEventListener('change', update);
    tabletMedia.addEventListener('change', update);
    return () => {
      mobileMedia.removeEventListener('change', update);
      tabletMedia.removeEventListener('change', update);
    };
  }, []);

  return density;
}

export function TeamTitlebarSummary({ pathname }: TeamTitlebarSummaryProps) {
  const workspaceLabel = useMemo(() => getWorkspaceLabel(pathname), [pathname]);
  const mobileWorkspaceLabel = useMemo(() => getMobileWorkspaceLabel(pathname), [pathname]);
  const density = useTitlebarDensity();
  const compact = density !== 'desktop';

  if (density === 'mobile') {
    return (
      <div
        aria-label="Team 工作台层级"
        title={workspaceLabel}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          color: 'var(--fg-muted)',
          fontSize: 11,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 20,
            padding: '0 7px',
            borderRadius: 9999,
            border: '1px solid var(--accent-border)',
            background: 'var(--accent-subtle)',
            color: 'var(--accent)',
            fontWeight: 700,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          团队
        </span>
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--fg-strong)',
            fontWeight: 650,
          }}
        >
          {mobileWorkspaceLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      aria-label="Team 工作台层级"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: density === 'desktop' ? 8 : 4,
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        color: 'var(--fg-muted)',
        fontSize: density === 'desktop' ? 12 : 11,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: density === 'desktop' ? 8 : 4,
          minWidth: 0,
          flexShrink: compact ? 1 : 0,
        }}
      >
        <span
          style={{
            color: 'var(--fg-default)',
            fontWeight: 650,
            whiteSpace: 'nowrap',
          }}
        >
          {density === 'desktop' ? '团队工作台' : '团队'}
        </span>
        <span aria-hidden="true" style={{ color: 'var(--border-strong)' }}>
          /
        </span>
        <span
          title={workspaceLabel}
          style={{
            maxWidth: density === 'tablet' ? 132 : 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--fg-strong)',
            fontWeight: 650,
          }}
        >
          {workspaceLabel}
        </span>
      </div>

      {density === 'desktop' ? (
        <span
          aria-label="Team 页面内导航提示"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 20,
            padding: '0 8px',
            borderRadius: 9999,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-overlay)',
            color: 'var(--fg-muted)',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          会话与文件在页内切换
        </span>
      ) : (
        <span
          aria-label="Team 页面内导航提示"
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--fg-subtle)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          页内切换
        </span>
      )}
    </div>
  );
}
