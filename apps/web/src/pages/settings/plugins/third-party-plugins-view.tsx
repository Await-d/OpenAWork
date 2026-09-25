/**
 * 已安装插件管理面的展示层：纯 props + 本地 UI 状态（安装输入 / 覆盖开关 /
 * 卸载二次确认）。容器 `ThirdPartyPluginsPanel` 负责数据加载与操作接线；
 * 本组件独立导出，供真实 Chromium harness 用 fixture 验收布局与语义色。
 */

import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { GatewayPluginInfo } from '@openAwork/web-client';

export interface ThirdPartyPluginsViewProps {
  /** 第三方插件清单（内置组已由容器过滤）。 */
  plugins: GatewayPluginInfo[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  statusMessage: string | null;
  onRefresh: () => void;
  /** 返回 true 表示安装成功（视图会清空输入）。 */
  onInstall: (path: string, force: boolean) => Promise<boolean>;
  onRemove: (installId: string) => void;
  onReload: (installId: string) => void;
  onDisable: (pluginId: string) => void;
  onEnable: (pluginId: string) => void;
}

const styles = `
[data-third-party-plugins] .tpp-btn {
  transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}
[data-third-party-plugins] .tpp-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-emphasis);
  color: var(--fg-strong);
}
[data-third-party-plugins] .tpp-btn-danger {
  color: var(--danger);
}
[data-third-party-plugins] .tpp-btn-danger:hover:not(:disabled) {
  background: var(--danger-muted);
  border-color: var(--danger-border);
  color: var(--danger);
}
[data-third-party-plugins] .tpp-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
[data-third-party-plugins] .tpp-btn-primary {
  background: var(--accent);
  border-color: var(--accent-border);
  color: var(--fg-on-accent);
}
[data-third-party-plugins] .tpp-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-border);
  color: var(--fg-on-accent);
}
[data-third-party-plugins] .tpp-input:focus {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px var(--accent-subtle);
  outline: none;
}
[data-third-party-plugins] :where(button, input):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
`;

const ghostButtonStyle = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 500,
  height: 28,
  padding: '0 10px',
} as const;

function Badge({
  tone,
  children,
}: {
  tone: 'success' | 'danger' | 'neutral';
  children: ReactNode;
}): ReactElement {
  const palette =
    tone === 'success'
      ? { bg: 'var(--success-muted)', border: 'var(--success-border)', color: 'var(--success)' }
      : tone === 'danger'
        ? { bg: 'var(--danger-muted)', border: 'var(--danger-border)', color: 'var(--danger)' }
        : { bg: 'var(--bg-elevated)', border: 'var(--border-default)', color: 'var(--fg-muted)' };
  return (
    <span
      data-tpp-badge={tone}
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 9999,
        color: palette.color,
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 8px',
      }}
    >
      {children}
    </span>
  );
}

function PluginRow({
  plugin,
  busy,
  confirming,
  onStartConfirm,
  onCancelConfirm,
  onRemove,
  onReload,
  onDisable,
  onEnable,
}: {
  plugin: GatewayPluginInfo;
  busy: boolean;
  confirming: boolean;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onRemove: () => void;
  onReload: () => void;
  onDisable: () => void;
  onEnable: () => void;
}): ReactElement {
  const failed = plugin.state.status === 'failed';
  const disabled = plugin.state.status === 'disabled';
  const installId = plugin.installId;

  return (
    <li
      data-tpp-row={plugin.id}
      data-tpp-state={failed ? 'failed' : disabled ? 'disabled' : 'active'}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        display: 'grid',
        gap: 6,
        padding: '10px 12px',
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
        <span
          aria-hidden
          data-tpp-status={failed ? 'failed' : disabled ? 'disabled' : 'active'}
          title={failed ? '激活失败' : disabled ? '已停用' : '运行中'}
          style={{
            background: failed ? 'var(--danger)' : disabled ? 'var(--fg-subtle)' : 'var(--success)',
            borderRadius: '50%',
            flexShrink: 0,
            height: 8,
            width: 8,
          }}
        />
        <span
          data-tpp-id={plugin.id}
          style={{
            color: disabled ? 'var(--fg-muted)' : 'var(--fg-strong)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            fontWeight: 600,
            maxWidth: 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {plugin.id}
        </span>
        <Badge tone={failed ? 'danger' : disabled ? 'neutral' : 'success'}>
          {failed ? '失败' : disabled ? '已停用' : '运行中'}
        </Badge>
        <Badge tone="neutral">{installId ? '已安装' : '外部加载'}</Badge>
        <span style={{ flex: 1 }} />
        {confirming ? (
          <>
            <button
              type="button"
              className="tpp-btn tpp-btn-danger"
              disabled={busy}
              onClick={onRemove}
              style={ghostButtonStyle}
            >
              确认卸载
            </button>
            <button
              type="button"
              className="tpp-btn"
              disabled={busy}
              onClick={onCancelConfirm}
              style={ghostButtonStyle}
            >
              取消
            </button>
          </>
        ) : (
          <>
            {!disabled && installId ? (
              <button
                type="button"
                className="tpp-btn"
                disabled={busy}
                onClick={onReload}
                title="重新加载该插件的入口文件"
                style={ghostButtonStyle}
              >
                重载
              </button>
            ) : null}
            {disabled ? (
              <button
                type="button"
                className="tpp-btn"
                disabled={busy}
                onClick={onEnable}
                title="重新加载并启用该插件"
                style={{ ...ghostButtonStyle, color: 'var(--accent)' }}
              >
                启用
              </button>
            ) : null}
            {!disabled && !plugin.guarded ? (
              <button
                type="button"
                className="tpp-btn"
                disabled={busy}
                onClick={onDisable}
                title="停用插件（保留安装，可随时启用）"
                style={ghostButtonStyle}
              >
                停用
              </button>
            ) : null}
            {installId && !plugin.guarded ? (
              <button
                type="button"
                className="tpp-btn tpp-btn-danger"
                disabled={busy}
                onClick={onStartConfirm}
                style={ghostButtonStyle}
              >
                卸载
              </button>
            ) : null}
          </>
        )}
      </div>

      {failed && plugin.state.error ? (
        <div
          data-tpp-error="true"
          role="alert"
          style={{ color: 'var(--danger)', fontSize: 11, lineHeight: 1.5 }}
        >
          {plugin.state.error}
        </div>
      ) : null}

      {plugin.source ? (
        <div
          data-tpp-source="true"
          title={plugin.source}
          style={{
            color: 'var(--fg-subtle)',
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {plugin.source}
        </div>
      ) : null}
    </li>
  );
}

export function ThirdPartyPluginsView({
  plugins,
  loading,
  error,
  busy,
  statusMessage,
  onRefresh,
  onInstall,
  onRemove,
  onReload,
  onDisable,
  onEnable,
}: ThirdPartyPluginsViewProps): ReactElement {
  const [installPath, setInstallPath] = useState('');
  const [force, setForce] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  return (
    <div
      data-third-party-plugins="true"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}
    >
      <style>{styles}</style>

      <p style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        插件是网关级的运行时扩展（工具 / hook /
        事件订阅），与网关同进程运行、没有沙箱——只安装你信任的代码。
        安装来源为网关所在机器的本地路径（目录或单文件）。内置插件（图片生成、桌面控制、浏览器自动化等）在各自面板中管理。
      </p>

      {statusMessage ? (
        <div role="status" style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
          {statusMessage}
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>加载中…</div>
      ) : error ? (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 12, lineHeight: 1.5 }}>
            {error}
          </div>
          <button type="button" className="tpp-btn" onClick={onRefresh} style={ghostButtonStyle}>
            重试
          </button>
        </div>
      ) : plugins.length === 0 ? (
        <div
          data-tpp-empty="true"
          style={{
            background: 'var(--bg-overlay)',
            border: '1px dashed var(--border-emphasis)',
            borderRadius: 12,
            padding: '32px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ color: 'var(--fg-strong)', fontSize: 14, fontWeight: 600 }}>
            还没有安装第三方插件
          </div>
          <p style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.5, margin: '6px 0 0' }}>
            在下方填写网关所在机器上的插件目录或单文件路径即可安装。
          </p>
        </div>
      ) : (
        <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
          {plugins.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              busy={busy}
              confirming={confirmingRemove !== null && confirmingRemove === plugin.installId}
              onStartConfirm={() => setConfirmingRemove(plugin.installId ?? null)}
              onCancelConfirm={() => setConfirmingRemove(null)}
              onRemove={() => {
                if (!plugin.installId) return;
                setConfirmingRemove(null);
                onRemove(plugin.installId);
              }}
              onReload={() => {
                if (!plugin.installId) return;
                onReload(plugin.installId);
              }}
              onDisable={() => onDisable(plugin.id)}
              onEnable={() => onEnable(plugin.id)}
            />
          ))}
        </ul>
      )}

      <form
        data-tpp-install-form="true"
        action={(formData) => {
          const target = String(formData.get('path') ?? '').trim();
          const overwrite = formData.get('force') === 'on';
          if (target.length === 0) return;
          void onInstall(target, overwrite).then((ok) => {
            if (ok) setInstallPath('');
          });
        }}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          display: 'grid',
          gap: 10,
          padding: 12,
        }}
      >
        <div style={{ color: 'var(--fg-strong)', fontSize: 12, fontWeight: 600 }}>安装新插件</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input
            className="tpp-input"
            name="path"
            type="text"
            value={installPath}
            onChange={(event) => setInstallPath(event.target.value)}
            placeholder="插件目录或单文件路径，例如 /srv/plugins/my-plugin"
            aria-label="插件路径"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              color: 'var(--fg-strong)',
              flex: '1 1 220px',
              fontSize: 12,
              height: 36,
              minWidth: 0,
              padding: '0 12px',
            }}
          />
          <label
            style={{
              alignItems: 'center',
              color: 'var(--fg-muted)',
              display: 'inline-flex',
              fontSize: 11,
              gap: 6,
            }}
          >
            <input
              name="force"
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
            />
            覆盖已有安装
          </label>
          <button
            type="submit"
            className="tpp-btn tpp-btn-primary"
            disabled={busy || installPath.trim().length === 0}
            style={{
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              height: 36,
              padding: '0 16px',
            }}
          >
            安装
          </button>
        </div>
        <div style={{ color: 'var(--fg-subtle)', fontSize: 11, lineHeight: 1.5 }}>
          npm / zip 安装尚未支持；安装成功后会立即激活，激活失败的原因会显示在上方列表中。
        </div>
      </form>
    </div>
  );
}
