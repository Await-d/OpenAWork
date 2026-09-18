/**
 * 「安装调试浏览器」入口：按钮 + 进行中进度 + 失败/不可用回退命令。
 *
 * 纯展示组件——状态机在 `useBrowserInstall`，宿主只透传 controller。仅在
 * `canInstall` 为 true（reason 可安装且凭据齐全）时渲染；disabled runtime 永不出现。
 */

import { useState } from 'react';
import type { BrowserInstallController } from './hooks/use-browser-install.js';
import { MANUAL_INSTALL_COMMAND } from './hooks/use-browser-install.js';

export interface InstallBrowserProgressProps {
  controller: BrowserInstallController;
}

function lastLine(lines: readonly string[]): string | null {
  return lines.length > 0 ? (lines[lines.length - 1] ?? null) : null;
}

export function InstallBrowserProgress({ controller }: InstallBrowserProgressProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const { status, starting, canInstall, start } = controller;

  if (!canInstall) {
    return null;
  }

  const running = starting || status?.state === 'running';
  const succeeded = status?.state === 'succeeded';
  const failed = status?.state === 'failed' || status?.state === 'unavailable';
  const busy = running || succeeded;

  const borderColor = focused
    ? 'var(--accent)'
    : hovered && !busy
      ? 'var(--accent-border)'
      : 'var(--border-emphasis)';
  const background = hovered && !busy ? 'var(--accent-subtle)' : 'var(--bg-raised)';
  const progressLine = lastLine(status?.tailLog ?? []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 6,
      }}
    >
      <button
        type="button"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 10px',
          borderRadius: 'var(--radius-xs)',
          border: `1px solid ${borderColor}`,
          background,
          color: busy ? 'var(--fg-muted)' : 'var(--fg-strong)',
          fontSize: 11,
          fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.85 : 1,
          transition: 'background 100ms ease, border-color 100ms ease, box-shadow 100ms ease',
          outline: focused ? '2px solid var(--accent)' : 'none',
          outlineOffset: focused ? 2 : 0,
          boxShadow: focused ? '0 0 0 4px var(--accent-subtle)' : 'none',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {running && (
          <span
            aria-hidden="true"
            data-testid="browser-install-spinner"
            style={{
              width: 10,
              height: 10,
              border: '2px solid var(--fg-subtle)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%',
              animation: 'oaw-browser-install-spin 800ms linear infinite',
            }}
          />
        )}
        {succeeded ? '已安装' : running ? '安装中…' : '安装调试浏览器'}
      </button>

      {running && progressLine !== null && (
        <span
          data-testid="browser-install-progress"
          style={{
            color: 'var(--fg-muted)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
        >
          {progressLine}
        </span>
      )}

      {failed && (
        <span data-testid="browser-install-error" style={{ color: 'var(--danger)', fontSize: 11 }}>
          {status?.error ?? '安装失败。'}
          {status?.state === 'unavailable' ? `（可手动执行：${MANUAL_INSTALL_COMMAND}）` : ''}
        </span>
      )}

      <style>{'@keyframes oaw-browser-install-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
