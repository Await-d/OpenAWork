import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { logger } from '../../../utils/log/logger.js';
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
} from '../../../utils/gateway/desktop-gateway.js';
import { tauriInvoke } from '../shared/settings-page-helpers.js';
import { BP, IS, SS, ST } from '../shared/settings-section-styles.js';

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

interface AdminPasswordStatus {
  exists: boolean;
  isDefault: boolean;
  email: string;
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  padding: '10px 12px',
  background: 'var(--bg-overlay)',
};

const SECONDARY_BTN: React.CSSProperties = {
  ...BP,
  background: 'transparent',
  border: '1px solid var(--border-default)',
  color: 'var(--fg-default)',
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
        background: checked ? 'var(--accent)' : 'var(--border-default)',
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
          background: 'var(--bg-overlay)',
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
  // admin 默认密码门控：sidecar 启动后会拉一次状态；isDefault=true 时
  // 必须改密才能切到 LAN 暴露，否则 admin@openAwork.local / admin123456
  // 会变成局域网攻击面。
  const [passwordStatus, setPasswordStatus] = useState<AdminPasswordStatus | null>(null);
  const [passwordCheckError, setPasswordCheckError] = useState<string | null>(null);
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

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

  // 拉一次 admin 密码状态 —— 仅当 sidecar 在跑时才能拿到结果。
  // sidecar 未跑时推迟到用户点 toggle on 才检查（在 handleToggleEnabled 里推动）。
  const refreshPasswordStatus = useCallback(async () => {
    if (!webAccessEnabled) {
      setPasswordStatus(null);
      setPasswordCheckError(null);
      return null;
    }
    try {
      const status = await tauriInvoke<AdminPasswordStatus>('admin_password_status');
      setPasswordStatus(status);
      setPasswordCheckError(null);
      return status;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '检查 admin 密码状态失败';
      setPasswordStatus(null);
      setPasswordCheckError(msg);
      logger.warn('admin_password_status failed', err);
      return null;
    }
  }, [webAccessEnabled]);

  // 进页时 / sidecar 状态变化时拉一下。webAccessEnabled 从 false → true 后会拉，
  // 从 true → false 会清理状态。
  useEffect(() => {
    void refreshPasswordStatus();
  }, [refreshPasswordStatus]);

  const handleToggleEnabled = useCallback(async () => {
    if (interactiveDisabled) return;
    setError(null);
    if (webAccessEnabled) {
      setBusy('stopping');
      try {
        await stopDesktopGateway();
        setWebAccess(false, webPort, webExposeLan);
        setPasswordStatus(null);
        setPasswordCheckError(null);
        setPwdSuccess(null);
        setPwdError(null);
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
      // 安全启动：不管用户选的 webExposeLan 是什么，首次启动先 bind 127.0.0.1，
      // 拿到 admin 密码状态后再决定要不要重启到 0.0.0.0。这样默认密码从未被
      // 暴露过 LAN，摆脱了「启动瞬间被扫到」的竞态。
      await startSidecar(targetPort, false);
      const status = await refreshPasswordStatus();
      if (status?.isDefault) {
        // sidecar 运行中（仅本机），开启状态保持，但不能升级到 LAN。
        // 后面的 PasswordSetupCard 会提示用户修改默认密码。
        if (webExposeLan) {
          // 用户原本选了 LAN，但未改密前不允许，静默回退到「仅本机」。
          setWebAccess(true, targetPort, false);
        }
        return;
      }
      // 密码已自定义：如果用户偏好 LAN，重启 sidecar 到正确 bind 模式。
      if (webExposeLan) {
        setBusy('switching');
        await stopDesktopGateway();
        await startSidecar(targetPort, true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动本地网关失败');
      logger.error('startDesktopGateway failed', err);
    } finally {
      setBusy(null);
    }
  }, [
    interactiveDisabled,
    portInput,
    refreshPasswordStatus,
    setWebAccess,
    startSidecar,
    webAccessEnabled,
    webExposeLan,
    webPort,
  ]);

  const handleSwitchExposeMode = useCallback(
    async (nextExposeLan: boolean) => {
      if (interactiveDisabled || nextExposeLan === webExposeLan) return;
      setError(null);

      // 默认密码尚未修改时不允许升级到 LAN。localhost-only 随意切。
      if (nextExposeLan && passwordStatus?.isDefault) {
        setError('请先在下方「Admin 账号安全」修改 admin 默认密码后，再开启同局域网访问。');
        return;
      }

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
    [
      interactiveDisabled,
      passwordStatus,
      setWebAccess,
      startSidecar,
      webAccessEnabled,
      webExposeLan,
      webPort,
    ],
  );

  /**
   * 提交 admin 新密码。后端会同时作废所有 refresh_tokens，所以这里后紧跟一次
   * authenticateDesktopGateway 重新拿令牌，避免当前会话在下一次 jwt 过期后无法刷新。
   */
  const submitPassword = useCallback(async () => {
    setPwdError(null);
    setPwdSuccess(null);
    if (pwd1.length < 8) {
      setPwdError('密码至少 8 位。');
      return;
    }
    if (pwd1.length > 128) {
      setPwdError('密码不能超过 128 位。');
      return;
    }
    if (pwd1 !== pwd2) {
      setPwdError('两次输入的密码不一致。');
      return;
    }
    setPwdSubmitting(true);
    try {
      await tauriInvoke('admin_set_password', { newPassword: pwd1 });
      // 后端作废了 refresh_tokens —— 重走一次 desktop-default 让桌面处于合法会话。
      const url = localGatewayUrl(webPort);
      const tokens = await authenticateDesktopGateway(url);
      setAuth(tokens.accessToken, DESKTOP_DEFAULT_EMAIL, tokens.refreshToken, tokens.expiresIn);
      await refreshPasswordStatus();
      setPwd1('');
      setPwd2('');
      setPwdSuccess('已修改。现在可以安全地切换到同局域网访问。');
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : '修改密码失败');
      logger.error('admin_set_password failed', err);
    } finally {
      setPwdSubmitting(false);
    }
  }, [pwd1, pwd2, refreshPasswordStatus, setAuth, webPort]);

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
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
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

      {/* 默认 admin 密码 = 写死的 admin123456。Web 一旦暴露到 LAN，攻击面巨大。
          这里强制提示并要求改密：sidecar 已启动 + 检测到 isDefault 时，把这块卡片
          顶到最显眼的位置，并把「同局域网」选项屏蔽，直到用户完成修改。 */}
      {!webAccessEnabled && passwordStatus === null && passwordCheckError === null ? (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
            fontSize: 11,
            color: 'var(--fg-default)',
            lineHeight: 1.6,
          }}
        >
          <strong>首次开启会先用「仅本机」模式启动 sidecar 检查 admin 默认密码状态</strong>
          。如果你之前从未改过密码，会要求先设新密码，再允许「同局域网」暴露。Web 默认关闭。
        </div>
      ) : null}

      {webAccessEnabled && passwordStatus?.isDefault ? (
        <div
          style={{
            padding: '12px',
            borderRadius: 10,
            border: '1px solid color-mix(in oklch, var(--danger) 35%, transparent)',
            background: 'color-mix(in oklch, var(--danger) 8%, transparent)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>
            ⚠ Admin 账号仍在使用默认密码
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.6 }}>
            账号 <code style={{ fontFamily: 'monospace' }}>{passwordStatus.email}</code>{' '}
            的密码当前为出厂默认值（<code style={{ fontFamily: 'monospace' }}>admin123456</code>
            ）。在改密前 sidecar 仅 bind 到 127.0.0.1，不会暴露到
            LAN；改完后才能切到「同局域网设备可访问」。
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input
              style={IS}
              type="password"
              placeholder="新密码（≥ 8 位）"
              value={pwd1}
              autoComplete="new-password"
              onChange={(event) => setPwd1(event.target.value)}
              disabled={pwdSubmitting}
            />
            <input
              style={IS}
              type="password"
              placeholder="再次输入"
              value={pwd2}
              autoComplete="new-password"
              onChange={(event) => setPwd2(event.target.value)}
              disabled={pwdSubmitting}
            />
          </div>
          {pwdError ? (
            <div role="alert" style={{ fontSize: 11, color: 'var(--danger)' }}>
              {pwdError}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => void submitPassword()}
              disabled={pwdSubmitting || pwd1.length === 0 || pwd2.length === 0}
              style={{ ...BP, opacity: pwdSubmitting ? 0.4 : 1 }}
            >
              {pwdSubmitting ? '提交中…' : '设置新密码'}
            </button>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              改完所有现有令牌会失效；桌面端会自动重新认证。
            </span>
          </div>
        </div>
      ) : null}

      {pwdSuccess ? (
        <div
          role="status"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            color: 'var(--accent)',
            fontSize: 12,
          }}
        >
          {pwdSuccess}
        </div>
      ) : null}

      {passwordCheckError ? (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid color-mix(in oklch, var(--danger) 25%, transparent)',
            background: 'color-mix(in oklch, var(--danger) 6%, transparent)',
            color: 'var(--danger)',
            fontSize: 11,
          }}
        >
          检查 admin 密码状态失败：{passwordCheckError}
        </div>
      ) : null}

      <div style={ROW_STYLE}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
            {webAccessEnabled ? '已启用 Web 端访问' : '当前未启用 Web 端访问'}
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--fg-muted)',
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
        <span style={{ fontSize: 11, color: 'var(--fg-default)', fontWeight: 600 }}>暴露范围</span>
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
            disabled={interactiveDisabled || passwordStatus?.isDefault === true}
            label="同局域网设备可访问"
            description={
              passwordStatus?.isDefault === true
                ? '需先在上方修改 admin 默认密码后才能开启。sidecar bind 0.0.0.0，同 Wi-Fi / 同有线网段的设备可通过本机 IP 访问。'
                : 'sidecar bind 0.0.0.0，同 Wi-Fi / 同有线网段的设备可通过本机 IP 访问。建议同时启用桌面端 PIN。'
            }
            onSelect={() => void handleSwitchExposeMode(true)}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-default)', fontWeight: 600 }}>监听端口</span>
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
        <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          应用后会停止再启动 sidecar 并自动重新认证；范围 1024 – 65535。
        </div>
      </div>

      {webAccessEnabled ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-default)', fontWeight: 600 }}>
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
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
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
                  background: 'var(--bg-overlay)',
                  border: '1px solid var(--border-default)',
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
          ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))'
          : ROW_STYLE.background,
        textAlign: 'left',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>{label}</div>
        <div
          style={{
            marginTop: 3,
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--fg-muted)',
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
          border: `2px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
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
