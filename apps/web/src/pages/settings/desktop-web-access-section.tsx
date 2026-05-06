import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { logger } from '../../utils/logger.js';
import {
  authenticateDesktopGateway,
  DEFAULT_GATEWAY_PORT,
  DESKTOP_DEFAULT_EMAIL,
  type DesktopGatewayBindMode,
  listLanAddresses,
  localGatewayUrl,
  parseGatewayPort,
  startDesktopGateway,
  stopDesktopGateway,
  waitForGatewayHealth,
  writeDesktopGatewayMode,
} from '../../utils/desktop-gateway.js';
import { tauriInvoke } from './settings-page-helpers.js';
import { BP, IS, SS, ST } from './settings-section-styles.js';

/**
 * 「桌面端」面板的「Web 端访问」section：让局域网内其他设备通过浏览器
 * 访问此桌面端启动的本地网关。
 *
 * 与「连接与模型」面板的「桌面网关切换」section 关系：
 * - 「桌面网关切换」承担本地↔远程网关切换语义；启停本地 sidecar 只是其副作用；
 * - 本 section 专注：启停 + 端口 + 暴露范围（仅本机 / 同局域网）+ URL 列表，
 *   并把 webExposeLan 持久化到 store，供其它路径（崩溃恢复、迁移重启等）读取。
 */

interface DesktopWebAccessSectionProps {
  webPort: number;
  webAccessEnabled: boolean;
  webExposeLan: boolean;
  setAuth: (accessToken: string, email: string, refreshToken?: string, expiresIn?: string) => void;
  setGatewayUrl: (url: string) => void;
  setWebAccess: (enabled: boolean, port: number, exposeLan?: boolean) => void;
  /** 父级数据迁移流水正在进行时禁用所有交互。 */
  migrationInFlight: boolean;
}

type BusyKind = null | 'starting' | 'stopping' | 'switching' | 'port';

const BUSY_LABELS: Record<Exclude<BusyKind, null>, string> = {
  starting: '正在启动本地网关…',
  stopping: '正在停止本地网关…',
  switching: '正在切换暴露范围…',
  port: '正在应用新端口…',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  padding: '10px 12px',
  background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
};

const SECONDARY_BTN: React.CSSProperties = {
  ...BP,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-2)',
};

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      disabled={disabled}
      onClick={onChange}
      style={{
        position: 'relative',
        width: 42,
        height: 24,
        borderRadius: 999,
        border: 'none',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--accent)' : 'var(--border)',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 20 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--surface)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
          transition: 'left 180ms ease',
        }}
      />
    </button>
  );
}

function bindModeFor(exposeLan: boolean): DesktopGatewayBindMode {
  return exposeLan ? 'lan' : 'localhost';
}

export function DesktopWebAccessSection({
  webPort,
  webAccessEnabled,
  webExposeLan,
  setAuth,
  setGatewayUrl,
  setWebAccess,
  migrationInFlight,
}: DesktopWebAccessSectionProps) {
  const [portInput, setPortInput] = useState(String(webPort));
  const [busy, setBusy] = useState<BusyKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);
  const [lanError, setLanError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // 当 store 中的 webPort 改变（其它面板修改）时同步 portInput。
  useEffect(() => {
    setPortInput(String(webPort));
  }, [webPort]);

  // 仅在 LAN 共享开启 + sidecar 启用时拉网卡列表，避免无谓 IPC。
  useEffect(() => {
    if (!webExposeLan || !webAccessEnabled) {
      setLanAddresses([]);
      setLanError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const addrs = await listLanAddresses();
        if (!cancelled) {
          setLanAddresses(addrs);
          setLanError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLanAddresses([]);
          setLanError(err instanceof Error ? err.message : '获取局域网 IP 失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webExposeLan, webAccessEnabled]);

  const interactiveDisabled = migrationInFlight || busy !== null;

  /**
   * 完整启动流水：start_gateway → 健康检查 → desktop-default 认证 → store 同步。
   * 抽到 useCallback 以便 toggle / 端口切换 / 暴露范围切换共用。
   */
  const startSidecar = useCallback(
    async (targetPort: number, exposeLan: boolean) => {
      const mode = bindModeFor(exposeLan);
      await startDesktopGateway(targetPort, mode);
      const url = localGatewayUrl(targetPort);
      if (!(await waitForGatewayHealth(url))) {
        throw new Error('本地网关健康检查失败，请检查端口是否被占用');
      }
      const tokens = await authenticateDesktopGateway(url);
      setAuth(tokens.accessToken, DESKTOP_DEFAULT_EMAIL, tokens.refreshToken, tokens.expiresIn);
      setGatewayUrl(url);
      setWebAccess(true, targetPort, exposeLan);
      writeDesktopGatewayMode('local');
    },
    [setAuth, setGatewayUrl, setWebAccess],
  );

  const handleToggleEnabled = useCallback(async () => {
    if (interactiveDisabled) return;
    setError(null);
    if (webAccessEnabled) {
      setBusy('stopping');
      try {
        await stopDesktopGateway();
        setWebAccess(false, webPort, webExposeLan);
      } catch (err) {
        setError(err instanceof Error ? err.message : '停止本地网关失败');
        logger.error('stopDesktopGateway failed', err);
      } finally {
        setBusy(null);
      }
      return;
    }
    const targetPort = parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT);
    setBusy('starting');
    try {
      await startSidecar(targetPort, webExposeLan);
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动本地网关失败');
      logger.error('startDesktopGateway failed', err);
    } finally {
      setBusy(null);
    }
  }, [interactiveDisabled, portInput, startSidecar, webAccessEnabled, webExposeLan, webPort]);

  const handleSwitchExposeMode = useCallback(
    async (nextExposeLan: boolean) => {
      if (interactiveDisabled || nextExposeLan === webExposeLan) return;
      setError(null);

      // 未启用时仅持久化偏好，下次启动按新值生效。
      if (!webAccessEnabled) {
        setWebAccess(false, webPort, nextExposeLan);
        return;
      }

      setBusy('switching');
      try {
        await stopDesktopGateway();
        await startSidecar(webPort, nextExposeLan);
      } catch (err) {
        setError(err instanceof Error ? err.message : '切换暴露范围失败');
        logger.error('switch expose mode failed', err);
      } finally {
        setBusy(null);
      }
    },
    [interactiveDisabled, setWebAccess, startSidecar, webAccessEnabled, webExposeLan, webPort],
  );

  const handleApplyPort = useCallback(async () => {
    if (interactiveDisabled) return;
    setError(null);
    const targetPort = parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT);

    if (targetPort === webPort) {
      return;
    }

    // sidecar 没在跑：仅同步偏好。
    if (!webAccessEnabled) {
      setWebAccess(false, targetPort, webExposeLan);
      const next = localGatewayUrl(targetPort);
      setGatewayUrl(next);
      writeDesktopGatewayMode('local');
      return;
    }

    setBusy('port');
    try {
      try {
        await stopDesktopGateway();
      } catch (err) {
        // 停止失败不致命，继续 start。
        logger.warn('stop_gateway failed while switching port', err);
      }
      await startSidecar(targetPort, webExposeLan);
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用新端口失败');
      logger.error('apply port failed', err);
    } finally {
      setBusy(null);
    }
  }, [
    interactiveDisabled,
    portInput,
    setGatewayUrl,
    setWebAccess,
    startSidecar,
    webAccessEnabled,
    webExposeLan,
    webPort,
  ]);

  const urls = useMemo(() => {
    if (!webAccessEnabled) return [] as string[];
    const list = [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`];
    if (webExposeLan) {
      for (const ip of lanAddresses) {
        list.push(`http://${ip}:${webPort}`);
      }
    }
    return list;
  }, [lanAddresses, webAccessEnabled, webExposeLan, webPort]);

  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => {
        setCopiedUrl((current) => (current === url ? null : current));
      }, 1500);
    } catch (err) {
      logger.warn('clipboard write failed', err);
    }
  }, []);

  const openUrl = useCallback(async (url: string) => {
    // 优先调 Tauri opener 让系统默认浏览器接管，失败时 fallback 到 window.open。
    try {
      await tauriInvoke('open_artifact_path', { path: url });
    } catch (err) {
      logger.warn('open_artifact_path failed; fallback to window.open', err);
      try {
        window.open(url, '_blank', 'noreferrer');
      } catch (fallbackErr) {
        logger.error('window.open fallback failed', fallbackErr);
      }
    }
  }, []);

  return (
    <section style={SS}>
      <h3 style={ST}>Web 端访问</h3>
      <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
        启用后，桌面端会在本机启动一个本地网关 sidecar；
        其他设备（手机、平板、另一台电脑等）可通过浏览器访问下方 URL 进入 Web 端。
        <strong>「同局域网设备可访问」会把 sidecar bind 到 0.0.0.0</strong>
        ，请配合下方桌面端 PIN 锁屏使用，避免局域网内任意访客直接进入会话。
      </div>

      {busy ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            color: 'var(--accent)',
            fontSize: 12,
          }}
        >
          {BUSY_LABELS[busy]}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid color-mix(in oklch, var(--danger) 30%, transparent)',
            background: 'color-mix(in oklch, var(--danger) 10%, transparent)',
            color: 'var(--danger)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={ROW_STYLE}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {webAccessEnabled ? '已启用 Web 端访问' : '当前未启用 Web 端访问'}
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--text-3)',
            }}
          >
            {webAccessEnabled
              ? '本地网关 sidecar 正在运行，桌面端与其他终端均可通过下方 URL 访问。'
              : '关闭后将停止本地网关 sidecar；其他设备无法访问，桌面端会改回内置直连。'}
          </div>
        </div>
        <ToggleSwitch
          ariaLabel="启用 Web 端访问"
          checked={webAccessEnabled}
          disabled={interactiveDisabled}
          onChange={() => void handleToggleEnabled()}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>暴露范围</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ExposeOption
            active={!webExposeLan}
            disabled={interactiveDisabled}
            label="仅本机访问"
            description="sidecar 仅 bind 127.0.0.1，只有本机浏览器/桌面端能访问。"
            onSelect={() => void handleSwitchExposeMode(false)}
          />
          <ExposeOption
            active={webExposeLan}
            disabled={interactiveDisabled}
            label="同局域网设备可访问"
            description="sidecar bind 0.0.0.0，同 Wi-Fi / 同有线网段的设备可通过本机 IP 访问。建议同时启用桌面端 PIN。"
            onSelect={() => void handleSwitchExposeMode(true)}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>监听端口</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...IS, maxWidth: 140 }}
            type="number"
            min={1024}
            max={65535}
            value={portInput}
            onChange={(event) => setPortInput(event.target.value)}
            disabled={interactiveDisabled}
            aria-label="本地网关监听端口"
          />
          <button
            type="button"
            onClick={() => void handleApplyPort()}
            disabled={interactiveDisabled}
            style={{ ...BP, opacity: interactiveDisabled ? 0.4 : 1 }}
          >
            {busy === 'port' ? '应用中…' : '应用'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
          应用后会停止再启动 sidecar 并自动重新认证；范围 1024 – 65535。
        </div>
      </div>

      {webAccessEnabled ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>
            可用访问地址
          </span>
          {webExposeLan && lanError ? (
            <div
              role="alert"
              style={{
                fontSize: 11,
                color: 'var(--danger)',
                lineHeight: 1.5,
              }}
            >
              获取局域网 IP 失败：{lanError}
            </div>
          ) : null}
          {webExposeLan && !lanError && lanAddresses.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
              未发现局域网 IPv4 网卡，可能未连接到任何网络。
            </div>
          ) : null}
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {urls.map((url) => (
              <li
                key={url}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '6px 10px',
                }}
              >
                <code
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: 'var(--accent)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={url}
                >
                  {url}
                </code>
                <button type="button" style={SECONDARY_BTN} onClick={() => void copyUrl(url)}>
                  {copiedUrl === url ? '✓ 已复制' : '复制'}
                </button>
                <button type="button" style={SECONDARY_BTN} onClick={() => void openUrl(url)}>
                  打开 ↗
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ExposeOption({
  active,
  disabled,
  description,
  label,
  onSelect,
}: {
  active: boolean;
  disabled: boolean;
  description: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      style={{
        ...ROW_STYLE,
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
        background: active
          ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))'
          : ROW_STYLE.background,
        textAlign: 'left',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div
          style={{
            marginTop: 3,
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--text-3)',
          }}
        >
          {description}
        </div>
      </div>
      <div
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {active ? (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--accent)',
            }}
          />
        ) : null}
      </div>
    </button>
  );
}
