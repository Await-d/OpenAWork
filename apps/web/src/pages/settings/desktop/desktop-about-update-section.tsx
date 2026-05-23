import type { CSSProperties } from 'react';
import { BP, SS, ST } from '../shared/settings-section-styles.js';

const RELEASES_URL = 'https://github.com/Await-d/OpenAWork/releases';

const FOCUS_RING_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]';

const SECONDARY_BUTTON: CSSProperties = {
  ...BP,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 34,
  background: 'transparent',
  border: '1px solid var(--border-default)',
  color: 'var(--fg-default)',
};

const PRIMARY_BUTTON: CSSProperties = {
  ...BP,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 34,
};

interface DesktopAboutUpdateSectionProps {
  onCheckUpdates?: () => void;
}

function formatBuildDate(input: string): string {
  if (!input) return '—';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return input;

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function AboutMetric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg-base) 38%, var(--bg-overlay))',
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 4 }}>{label}</div>
      <div
        translate="no"
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--fg-strong)',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={value}
      >
        {value || '—'}
      </div>
    </div>
  );
}

export function DesktopAboutUpdateSection({ onCheckUpdates }: DesktopAboutUpdateSectionProps) {
  const canCheckUpdates = typeof onCheckUpdates === 'function';

  return (
    <section
      style={{
        ...SS,
        position: 'relative',
        overflow: 'hidden',
        borderColor: 'var(--accent-border)',
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--bg-overlay)), var(--bg-overlay) 58%)',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -40,
          top: -48,
          width: 160,
          height: 160,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--accent-subtle), transparent 68%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 12, minWidth: 0, flex: '1 1 280px' }}>
          <div
            aria-hidden
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent-muted)',
              border: '1px solid var(--accent-border)',
              color: 'var(--accent)',
              boxShadow: 'var(--shadow-glow)',
              flexShrink: 0,
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v12" />
              <path d="m8 11 4 4 4-4" />
              <path d="M5 21h14" />
            </svg>
          </div>

          <div style={{ minWidth: 0 }}>
            <h3 style={{ ...ST, color: 'var(--fg-strong)', margin: 0, textWrap: 'balance' }}>
              关于与更新
            </h3>
            <div
              style={{ marginTop: 5, fontSize: 12, color: 'var(--fg-default)', lineHeight: 1.6 }}
            >
              <span translate="no">OpenAWork</span> 桌面端 ·{' '}
              <span translate="no">v{__APP_VERSION__}</span>。这里合并展示构建信息与软件更新入口，
              更新流程沿用托盘菜单的下载、安装与 GitHub 代理回退能力。
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className={FOCUS_RING_CLASS}
            style={{ ...PRIMARY_BUTTON, opacity: canCheckUpdates ? 1 : 0.56 }}
            onClick={onCheckUpdates}
            disabled={!canCheckUpdates}
            title={canCheckUpdates ? '打开桌面端更新面板' : '当前运行环境不可用'}
          >
            <span aria-hidden>↻</span>
            检查更新
          </button>
          <button
            type="button"
            className={FOCUS_RING_CLASS}
            style={SECONDARY_BUTTON}
            onClick={() => window.open(RELEASES_URL, '_blank', 'noopener,noreferrer')}
          >
            GitHub 发布记录
          </button>
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
        }}
      >
        <AboutMetric label="当前版本" value={`v${__APP_VERSION__}`} />
        <AboutMetric label="构建版本" value={__APP_BUILD_VERSION__} />
        <AboutMetric label="构建时间" value={formatBuildDate(__APP_BUILD_TIME__)} />
      </div>
    </section>
  );
}
