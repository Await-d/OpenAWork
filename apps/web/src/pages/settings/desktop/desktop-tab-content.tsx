import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { getPairingQr, type PairingQrResponse } from '@openAwork/web-client';
import { QRCodeDisplay } from '@openAwork/shared-ui';
import { PinInput } from '../../../components/common/PinInput.js';
import { useAuthStore } from '../../../stores/auth.js';
import { logger } from '../../../utils/logger.js';
import {
  authenticateDesktopGateway,
  DESKTOP_DEFAULT_EMAIL,
  localGatewayUrl,
  waitForGatewayHealth,
} from '../../../utils/gateway/desktop-gateway.js';
import { DesktopWebAccessSection } from './desktop-web-access-section.js';
import { isTauri, tauriInvoke } from '../shared/settings-page-helpers.js';
import { BP, IS, SS, ST } from '../shared/settings-section-styles.js';

/**
 * 分阶段 busy 状态。
 *
 * `migrate:*` / `reset:*` 模拟「准备 → 重启 → 认证」三步流水：
 * - `*:prepare`：Rust 端 `migrate_data_root` 在跑（内部含 stop → copy → verify → remove）
 * - `*:restart`：前端调 `start_gateway(port)` 重启 sidecar。
 * - `*:auth`：调 `authenticateDesktopGateway` 刷新本地令牌。
 */
type BusyState =
  | null
  | 'close'
  | 'autostart'
  | 'migrate:prepare'
  | 'migrate:restart'
  | 'migrate:auth'
  | 'reset:prepare'
  | 'reset:restart'
  | 'reset:auth';

const BUSY_LABELS: Record<Exclude<BusyState, null>, string> = {
  close: '保存关闭行为中…',
  autostart: '切换开机自启中…',
  'migrate:prepare': '迁移数据中（停止 sidecar / 拷贝 / 校验）…',
  'migrate:restart': '以新目录重启本地网关中…',
  'migrate:auth': '重新认证本地网关中…',
  'reset:prepare': '重置为默认目录中（停止 sidecar / 拷贝 / 校验）…',
  'reset:restart': '以默认目录重启本地网关中…',
  'reset:auth': '重新认证本地网关中…',
};

/** 桌面端关闭按钮行为（与 Rust `CloseBehavior` enum 对齐，serde kebab-case）。 */
type CloseBehaviorValue = 'ask' | 'minimize' | 'exit';

/** 与 Rust `DesktopSettingsView` 完全对齐。 */
interface DesktopSettingsView {
  closeBehavior: CloseBehaviorValue;
  hasSeenTrayHint: boolean;
  effectiveDataRoot: string;
  customDataRoot: string | null;
  defaultDataRoot: string;
  settingsFilePath: string;
  autostartEnabled: boolean;
  hasPin: boolean;
  idleLockMinutes: number | null;
  pinDigits: number;
}

/** 空闲自动锁预设分钟选项。`null` 表示禁用。 */
const IDLE_LOCK_PRESETS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: '禁用', value: null },
  { label: '5 分钟', value: 5 },
  { label: '10 分钟', value: 10 },
  { label: '30 分钟', value: 30 },
  { label: '60 分钟', value: 60 },
];

/** PIN 管理面板的交互阶段。 */
type PinPanelMode = 'idle' | 'set' | 'change' | 'remove';

const CLOSE_BEHAVIOR_OPTIONS: ReadonlyArray<{
  value: CloseBehaviorValue;
  label: string;
  description: string;
}> = [
  {
    value: 'ask',
    label: '每次询问',
    description: '点击关闭按钮时弹出对话框，由用户当场选择最小化或退出。',
  },
  {
    value: 'minimize',
    label: '直接最小化到托盘',
    description: '保留后台运行（含本地网关），不再弹窗确认。',
  },
  {
    value: 'exit',
    label: '直接退出',
    description: '关闭按钮 = 完全退出应用，并停止本会话启动的 sidecar。',
  },
];

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

const PATH_BOX: React.CSSProperties = {
  ...IS,
  flex: 1,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const SECONDARY_BTN: React.CSSProperties = {
  ...BP,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-2)',
};

const DANGER_BTN: React.CSSProperties = {
  ...SECONDARY_BTN,
  color: 'var(--danger, var(--danger, var(--danger, #f06b7e)))',
  borderColor: 'color-mix(in srgb, var(--danger, var(--danger, var(--danger, #f06b7e))) 40%, transparent)',
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

/** 仅在 Tauri 运行时渲染——非桌面端时显示一个降级提示。 */
export function DesktopTabContent() {
  const webPort = useAuthStore((state) => state.webPort);
  const webAccessEnabled = useAuthStore((state) => state.webAccessEnabled);
  const webExposeLan = useAuthStore((state) => state.webExposeLan);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const accessToken = useAuthStore((state) => state.accessToken);
  const setAuth = useAuthStore((state) => state.setAuth);
  const setGatewayUrl = useAuthStore((state) => state.setGatewayUrl);
  const setWebAccess = useAuthStore((state) => state.setWebAccess);

  const [view, setView] = useState<DesktopSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [autostartMsg, setAutostartMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // 配对二维码状态：按需加载，避免进页就生成 QR（PAIRING_TTL_MS 5 分钟会不必要地消耗 token）。
  const [pairingQr, setPairingQr] = useState<PairingQrResponse | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingVisible, setPairingVisible] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri) {
      setLoading(false);
      return;
    }
    try {
      const next = await tauriInvoke<DesktopSettingsView>('get_desktop_settings');
      setView(next);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error('get_desktop_settings failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateCloseBehavior = useCallback(
    async (next: CloseBehaviorValue) => {
      if (!view || view.closeBehavior === next) return;
      setBusy('close');
      try {
        const updated = await tauriInvoke<DesktopSettingsView>('update_desktop_settings', {
          patch: { closeBehavior: next },
        });
        setView(updated);
        setError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        logger.error('update_desktop_settings(close_behavior) failed', err);
      } finally {
        setBusy(null);
      }
    },
    [view],
  );

  const toggleAutostart = useCallback(async () => {
    if (!view) return;
    const target = !view.autostartEnabled;
    setBusy('autostart');
    setAutostartMsg(null);
    try {
      const updated = await tauriInvoke<DesktopSettingsView>('set_autostart_enabled', {
        enabled: target,
      });
      setView(updated);
      setError(null);
      setAutostartMsg({
        type: 'success',
        text: target
          ? '已成功启用开机自启。下次开机时将自动启动 OpenAWork。'
          : '已关闭开机自启。下次开机不会自动启动。',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAutostartMsg({ type: 'error', text: `操作失败：${msg}` });
      logger.error('set_autostart_enabled failed', err);
    } finally {
      setBusy(null);
    }
  }, [view]);

  /**
   * 执行「迁移/重置」这类「改 data_root」动作的完整流水：
   * 1. `*:prepare` —— 调 `migrate_data_root`（Rust 端停 sidecar + 拷贝 + 校验 + 删旧）；
   * 2. `*:restart` —— 如本地网关启用，调 `start_gateway(port)` 重启 sidecar；
   * 3. `*:auth` —— `waitForGatewayHealth` + `authenticateDesktopGateway` + setAuth 刷新令牌。
   *
   * 当前处于「远程网关」或「未启用本地网关」的状态时仅执行 step 1，
   * 因为 sidecar 本就没在跑——用户手动切到本地模式时会重新 start_gateway。
   */
  useEffect(() => {
    if (autostartMsg?.type !== 'success') return;
    const id = setTimeout(() => setAutostartMsg(null), 3500);
    return () => clearTimeout(id);
  }, [autostartMsg]);

  const runMigration = useCallback(
    async (newRoot: string, kind: 'migrate' | 'reset', context: string) => {
      // Step 1：迁移数据
      setBusy(`${kind}:prepare` as BusyState);
      const updated = await tauriInvoke<DesktopSettingsView>('migrate_data_root', {
        newRoot,
      });
      setView(updated);

      // 未启用本地网关，或者当前 gateway 不在本地——不需要重启 sidecar。
      // 用户下次在「连接与模型」页启用本地网关时，会用新 data_root 启动。
      if (!webAccessEnabled) {
        setBusy(null);
        return;
      }

      // Step 2：以当前端口重启 sidecar（新的 OPENAWORK_DATA_DIR 会自动注入）。
      // 重启时按 store 中的 webExposeLan 决定 bind 模式，避免 LAN 共享设置在数据迁移后丢失。
      setBusy(`${kind}:restart` as BusyState);
      await tauriInvoke('start_gateway', {
        port: webPort,
        host: webExposeLan ? '0.0.0.0' : '127.0.0.1',
      });
      const nextGatewayUrl = localGatewayUrl(webPort);

      // Step 3：重新认证
      setBusy(`${kind}:auth` as BusyState);
      const healthy = await waitForGatewayHealth(nextGatewayUrl);
      if (!healthy) {
        throw new Error(`${context}后本地网关健康检查失败，请手动重启桌面端。`);
      }
      const tokenPair = await authenticateDesktopGateway(nextGatewayUrl);
      setAuth(
        tokenPair.accessToken,
        DESKTOP_DEFAULT_EMAIL,
        tokenPair.refreshToken,
        tokenPair.expiresIn,
      );
      setGatewayUrl(nextGatewayUrl);
      setWebAccess(true, webPort);
      setBusy(null);
    },
    [setAuth, setGatewayUrl, setWebAccess, webAccessEnabled, webExposeLan, webPort],
  );

  const pickAndMigrate = useCallback(async () => {
    if (!view) return;
    try {
      const picked = await tauriInvoke<string | null>('pick_folder');
      if (!picked) {
        return;
      }
      await runMigration(picked, 'migrate', '迁移');
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`迁移失败：${msg}`);
      logger.error('migrate_data_root (pick) failed', err);
      setBusy(null);
    }
  }, [runMigration, view]);

  const resetToDefault = useCallback(async () => {
    if (!view || !view.customDataRoot) return;
    try {
      await runMigration(view.defaultDataRoot, 'reset', '重置');
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`重置失败：${msg}`);
      logger.error('migrate_data_root (reset) failed', err);
      setBusy(null);
    }
  }, [runMigration, view]);

  const openSettingsFile = useCallback(async () => {
    if (!view) return;
    try {
      await tauriInvoke('open_artifact_path', { path: view.effectiveDataRoot });
    } catch (err) {
      logger.error('open_artifact_path failed', err);
    }
  }, [view]);

  /**
   * 生成或刷新配对二维码。
   *
   * 调 gateway `/pairing/qr` 拿一次性 token（TTL 5 分钟）。
   * 权限：desktop-auth-token 或 admin JWT——桌面端默认经 `desktop-default` 登录后是 admin，
   * 所以 `accessToken` 正常下能拿到。
   */
  const refreshPairingQr = useCallback(async () => {
    if (!gatewayUrl) {
      setPairingError('尚未配置网关地址');
      return;
    }
    setPairingLoading(true);
    setPairingError(null);
    try {
      const next = await getPairingQr(gatewayUrl, accessToken ?? undefined);
      setPairingQr(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPairingError(msg);
      logger.error('getPairingQr failed', err);
    } finally {
      setPairingLoading(false);
    }
  }, [accessToken, gatewayUrl]);

  const togglePairingVisible = useCallback(() => {
    setPairingVisible((prev) => {
      const next = !prev;
      // 第一次打开或 QR 已过期时才自动加载。
      if (next && (!pairingQr || pairingQr.expiresAt <= Date.now())) {
        void refreshPairingQr();
      }
      return next;
    });
  }, [pairingQr, refreshPairingQr]);

  const copyPairingPayload = useCallback(async () => {
    if (!pairingQr) return;
    try {
      await navigator.clipboard.writeText(pairingQr.qrData);
    } catch (err) {
      logger.error('copy pairing payload failed', err);
    }
  }, [pairingQr]);

  // PIN 管理 state。交互设计：
  // - 未设 PIN 时 → 'idle' 显示「设置 PIN」按钮、点击进 'set' 表单；
  // - 已设 PIN 时 → 'idle' 显示「修改」 / 「移除」按钮，点击划到对应表单。
  const [pinMode, setPinMode] = useState<PinPanelMode>('idle');
  const [pinNew, setPinNew] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const resetPinForm = useCallback(() => {
    setPinNew('');
    setPinConfirm('');
    setPinCurrent('');
    setPinError(null);
  }, []);

  const submitSetPin = useCallback(async () => {
    if (pinBusy) return;
    if (!view || pinNew.length < view.pinDigits) {
      setPinError(`新 PIN 须为 ${view?.pinDigits ?? 6} 位数字`);
      return;
    }
    if (pinNew !== pinConfirm) {
      setPinError('两次输入不一致');
      return;
    }
    setPinBusy(true);
    setPinError(null);
    try {
      const updated = await tauriInvoke<DesktopSettingsView>('set_desktop_pin', {
        pin: pinNew,
        currentPin: pinMode === 'change' ? pinCurrent : null,
      });
      setView(updated);
      setPinMode('idle');
      resetPinForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPinError(msg);
      logger.error('set_desktop_pin failed', err);
    } finally {
      setPinBusy(false);
    }
  }, [pinBusy, pinConfirm, pinCurrent, pinMode, pinNew, resetPinForm]);

  const updateIdleLockMinutes = useCallback(async (next: number | null) => {
    try {
      const updated = await tauriInvoke<DesktopSettingsView>('update_desktop_settings', {
        patch: { idleLockMinutes: next },
      });
      setView(updated);
    } catch (err) {
      logger.error('update_desktop_settings(idle_lock_minutes) failed', err);
    }
  }, []);

  const submitRemovePin = useCallback(async () => {
    if (pinBusy) return;
    if (!pinCurrent) {
      setPinError('请输入当前 PIN');
      return;
    }
    setPinBusy(true);
    setPinError(null);
    try {
      const updated = await tauriInvoke<DesktopSettingsView>('remove_desktop_pin', {
        currentPin: pinCurrent,
      });
      setView(updated);
      setPinMode('idle');
      resetPinForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPinError(msg);
      logger.error('remove_desktop_pin failed', err);
    } finally {
      setPinBusy(false);
    }
  }, [pinBusy, pinCurrent, resetPinForm]);

  // 托盘菜单「显示配对二维码」入口：App.tsx 接事件后 navigate '/settings/desktop?show=pairing'。
  // 这里检测到该参数时自动展开 + 刷新 QR，随后清掉参数避免后续重复触发。
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('show') !== 'pairing') return;
    setPairingVisible(true);
    void refreshPairingQr();
    const next = new URLSearchParams(searchParams);
    next.delete('show');
    setSearchParams(next, { replace: true });
  }, [refreshPairingQr, searchParams, setSearchParams]);

  if (!isTauri) {
    return (
      <section style={SS}>
        <h3 style={ST}>桌面端</h3>
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
          这些设置仅在 OpenAWork 桌面端（Tauri）应用中生效。请在桌面端启动后再访问此面板。
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section style={SS}>
        <h3 style={ST}>桌面端</h3>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>正在加载桌面端配置…</div>
      </section>
    );
  }

  if (!view) {
    return (
      <section style={SS}>
        <h3 style={ST}>桌面端</h3>
        <div style={{ fontSize: 12, color: 'var(--danger, var(--danger, var(--danger, #f06b7e)))' }}>
          {error ?? '桌面端配置加载失败。请重启应用后重试。'}
        </div>
      </section>
    );
  }

  const migrationInFlight =
    busy !== null && (busy.startsWith('migrate:') || busy.startsWith('reset:'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {busy !== null ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            color: 'var(--accent)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid currentColor',
              borderTopColor: 'transparent',
              animation: 'desktop-settings-spin 0.8s linear infinite',
              flexShrink: 0,
            }}
          />
          <span>{BUSY_LABELS[busy]}</span>
          <style>{`@keyframes desktop-settings-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--danger, var(--danger, var(--danger, #f06b7e))) 40%, transparent)',
            background: 'color-mix(in srgb, var(--danger, var(--danger, var(--danger, #f06b7e))) 8%, transparent)',
            color: 'var(--danger, var(--danger, var(--danger, #f06b7e)))',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      <section style={SS}>
        <h3 style={ST}>关闭按钮行为</h3>
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
          决定点击主窗口右上角 X
          按钮时的默认动作。也可在右键托盘菜单的「关闭按钮行为」子菜单实时切换。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CLOSE_BEHAVIOR_OPTIONS.map((opt) => {
            const active = view.closeBehavior === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={busy === 'close' || migrationInFlight}
                onClick={() => void updateCloseBehavior(opt.value)}
                style={{
                  ...ROW_STYLE,
                  cursor: 'pointer',
                  borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                  background: active
                    ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))'
                    : ROW_STYLE.background,
                  textAlign: 'left',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                    {opt.label}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: 'var(--text-3)',
                    }}
                  >
                    {opt.description}
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
          })}
        </div>
      </section>

      <section style={SS}>
        <h3 style={ST}>开机自启</h3>
        <div style={ROW_STYLE}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
              开机时自动启动 OpenAWork
            </div>
            <div
              style={{
                marginTop: 3,
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--text-3)',
              }}
            >
              通过系统级机制注册（Windows: 注册表 Run 项 / macOS: LaunchAgent / Linux: autostart）。
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {busy === 'autostart' ? (
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '2px solid var(--accent)',
                  borderTopColor: 'transparent',
                  animation: 'desktop-settings-spin 0.8s linear infinite',
                  flexShrink: 0,
                }}
              />
            ) : null}
            <ToggleSwitch
              ariaLabel="开机自启"
              checked={view.autostartEnabled}
              disabled={busy === 'autostart' || migrationInFlight}
              onChange={() => void toggleAutostart()}
            />
          </div>
        </div>
        {autostartMsg ? (
          <div
            role={autostartMsg.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 11,
              lineHeight: 1.5,
              border:
                autostartMsg.type === 'success'
                  ? '1px solid color-mix(in srgb, var(--success, #3dd49a) 35%, transparent)'
                  : '1px solid color-mix(in srgb, var(--danger, var(--danger, var(--danger, #f06b7e))) 40%, transparent)',
              background:
                autostartMsg.type === 'success'
                  ? 'color-mix(in srgb, var(--success, #3dd49a) 8%, transparent)'
                  : 'color-mix(in srgb, var(--danger, var(--danger, var(--danger, #f06b7e))) 8%, transparent)',
              color: autostartMsg.type === 'success' ? 'var(--success, #3dd49a)' : 'var(--danger, var(--danger, var(--danger, #f06b7e)))',
            }}
          >
            <span aria-hidden style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>
              {autostartMsg.type === 'success' ? '✓' : '✕'}
            </span>
            <span>{autostartMsg.text}</span>
            {autostartMsg.type === 'error' ? (
              <button
                type="button"
                aria-label="关闭提示"
                onClick={() => setAutostartMsg(null)}
                style={{
                  marginLeft: 'auto',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  opacity: 0.7,
                  padding: '0 2px',
                  fontSize: 13,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <DesktopWebAccessSection
        webPort={webPort}
        webAccessEnabled={webAccessEnabled}
        webExposeLan={webExposeLan}
        setAuth={setAuth}
        setGatewayUrl={setGatewayUrl}
        setWebAccess={setWebAccess}
        migrationInFlight={migrationInFlight}
      />

      <section style={SS}>
        <h3 style={ST}>数据根目录</h3>
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
          所有桌面端持久化数据（Gateway 数据库、缓存等）的存放根目录。 切换后将自动停止 sidecar，把
          <code
            style={{
              padding: '0 4px',
              borderRadius: 4,
              background: 'var(--surface-raised, var(--surface))',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            agent-gateway/
          </code>
          子目录拷贝到新位置并校验，成功后删除原位置。
          <strong> 注意：</strong> <code>desktop-settings.json</code> 始终保留在
          <code
            style={{
              padding: '0 4px',
              borderRadius: 4,
              background: 'var(--surface-raised, var(--surface))',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            ~/.openAwork/
          </code>
          ，不随此设置迁移。
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>
            当前生效的数据目录
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={PATH_BOX} title={view.effectiveDataRoot}>
              {view.effectiveDataRoot}
            </code>
            <button
              type="button"
              style={SECONDARY_BTN}
              onClick={() => void openSettingsFile()}
              disabled={migrationInFlight}
            >
              在文件管理器中打开
            </button>
          </div>
          {view.customDataRoot ? (
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
              已自定义；默认为 <code>{view.defaultDataRoot}</code>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>当前使用默认根目录</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={BP}
            onClick={() => void pickAndMigrate()}
            disabled={migrationInFlight}
          >
            {busy?.startsWith('migrate:') ? '迁移中…' : '选择新目录并迁移'}
          </button>
          {view.customDataRoot ? (
            <button
              type="button"
              style={DANGER_BTN}
              onClick={() => void resetToDefault()}
              disabled={migrationInFlight}
            >
              {busy?.startsWith('reset:') ? '重置中…' : '重置为默认目录'}
            </button>
          ) : null}
        </div>
      </section>

      <section style={SS}>
        <h3 style={ST}>解锁 PIN</h3>
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
          为桌面端设置一个 4-8 位数字 PIN。每次<strong>应用启动</strong>或
          <strong>从托盘唤醒主窗口</strong>时都会要求输入 PIN，避免他人开机后直接看到 OpenAWork
          数据。PIN 仅在本机存储 argon2 哈希，不会同步到 Gateway。
        </div>

        {pinMode === 'idle' && view.hasPin ? (
          <div
            style={{
              ...ROW_STYLE,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>空闲自动锁</div>
              <div
                style={{
                  marginTop: 3,
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: 'var(--text-3)',
                }}
              >
                超过设定时长无键鼠活动时自动锁定。选「禁用」则仅启动和从托盘唤醒时要求 PIN。
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {IDLE_LOCK_PRESETS.map((opt) => {
                const active = (view.idleLockMinutes ?? null) === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => void updateIdleLockMinutes(opt.value)}
                    disabled={migrationInFlight}
                    style={{
                      borderRadius: 6,
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active
                        ? 'color-mix(in srgb, var(--accent) 15%, var(--surface))'
                        : 'var(--surface)',
                      color: active ? 'var(--accent)' : 'var(--text-2)',
                      padding: '4px 10px',
                      fontSize: 11,
                      cursor: migrationInFlight ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {pinMode === 'idle' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={ROW_STYLE}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  {view.hasPin ? '已启用 PIN 锁屏' : '当前未设置 PIN'}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: 'var(--text-3)',
                  }}
                >
                  {view.hasPin
                    ? '可点击右侧按钮修改或移除 PIN。'
                    : '建议为桌面端配置 PIN，特别是开启了「开机自启」时。'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {view.hasPin ? (
                  <>
                    <button
                      type="button"
                      style={SECONDARY_BTN}
                      onClick={() => {
                        resetPinForm();
                        setPinMode('change');
                      }}
                      disabled={migrationInFlight}
                    >
                      修改 PIN
                    </button>
                    <button
                      type="button"
                      style={DANGER_BTN}
                      onClick={() => {
                        resetPinForm();
                        setPinMode('remove');
                      }}
                      disabled={migrationInFlight}
                    >
                      移除
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    style={BP}
                    onClick={() => {
                      resetPinForm();
                      setPinMode('set');
                    }}
                    disabled={migrationInFlight}
                  >
                    设置 PIN
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              padding: '16px 18px',
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
            }}
          >
            {pinMode === 'change' || pinMode === 'remove' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>
                  当前 PIN
                </span>
                <PinInput
                  value={pinCurrent}
                  onChange={(next) => {
                    setPinCurrent(next);
                    setPinError(null);
                  }}
                  length={view.pinDigits}
                  autoFocus
                  disabled={pinBusy}
                  error={!!pinError}
                  ariaLabel="当前 PIN"
                />
              </div>
            ) : null}

            {pinMode === 'set' || pinMode === 'change' ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>
                    新 PIN（{view.pinDigits} 位数字）
                  </span>
                  <PinInput
                    value={pinNew}
                    onChange={(next) => {
                      setPinNew(next);
                      setPinError(null);
                    }}
                    length={view.pinDigits}
                    autoFocus={pinMode === 'set'}
                    disabled={pinBusy}
                    error={!!pinError}
                    ariaLabel="新 PIN"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>
                    确认新 PIN
                  </span>
                  <PinInput
                    value={pinConfirm}
                    onChange={(next) => {
                      setPinConfirm(next);
                      setPinError(null);
                    }}
                    length={view.pinDigits}
                    disabled={pinBusy}
                    error={!!pinError}
                    ariaLabel="确认新 PIN"
                  />
                </div>
              </>
            ) : null}

            {pinError ? (
              <div
                role="alert"
                style={{ fontSize: 11, color: 'var(--danger, var(--danger, var(--danger, #f06b7e)))', lineHeight: 1.5 }}
              >
                {pinError}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={pinMode === 'remove' ? DANGER_BTN : BP}
                onClick={() => {
                  if (pinMode === 'remove') {
                    void submitRemovePin();
                  } else {
                    void submitSetPin();
                  }
                }}
                disabled={pinBusy}
              >
                {pinBusy
                  ? '提交中…'
                  : pinMode === 'remove'
                    ? '确认移除 PIN'
                    : pinMode === 'change'
                      ? '保存新 PIN'
                      : '设置 PIN'}
              </button>
              <button
                type="button"
                style={SECONDARY_BTN}
                onClick={() => {
                  setPinMode('idle');
                  resetPinForm();
                }}
                disabled={pinBusy}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      <section style={SS}>
        <h3 style={ST}>手机端配对</h3>
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
          生成一次性二维码让手机端 APP 扫描登录。二维码有效期 5 分钟，扫描后手机端会直接完成登录，
          并共享此桌面端的 admin 会话。
        </div>

        {!pairingVisible ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={BP} onClick={togglePairingVisible}>
              显示配对二维码
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pairingLoading && !pairingQr ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>正在生成二维码…</div>
            ) : null}

            {pairingError ? (
              <div
                role="alert"
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--danger, var(--danger, var(--danger, #f06b7e))) 40%, transparent)',
                  background: 'color-mix(in srgb, var(--danger, var(--danger, var(--danger, #f06b7e))) 8%, transparent)',
                  color: 'var(--danger, var(--danger, var(--danger, #f06b7e)))',
                  fontSize: 12,
                }}
              >
                {pairingError}
              </div>
            ) : null}

            {pairingQr ? (
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                }}
              >
                <QRCodeDisplay
                  qrData={pairingQr.qrData}
                  expiresAt={pairingQr.expiresAt}
                  onRefresh={() => void refreshPairingQr()}
                  size={180}
                />
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>
                    手机端扫描步骤
                  </span>
                  <ol
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      fontSize: 11,
                      color: 'var(--text-3)',
                      lineHeight: 1.6,
                    }}
                  >
                    <li>打开 OpenAWork 手机端 APP，进入引导页「连接已有 Host」</li>
                    <li>点击「扫描 QR 码」并对准此二维码</li>
                    <li>扫描成功后手机端会自动完成登录</li>
                  </ol>

                  <div style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>
                      Host 地址
                    </span>
                    <code
                      style={{ ...PATH_BOX, marginTop: 4, maxWidth: '100%' }}
                      title={pairingQr.hostUrl}
                    >
                      {pairingQr.hostUrl}
                    </code>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    <button
                      type="button"
                      style={SECONDARY_BTN}
                      onClick={() => void refreshPairingQr()}
                      disabled={pairingLoading}
                    >
                      {pairingLoading ? '刷新中…' : '重新生成'}
                    </button>
                    <button
                      type="button"
                      style={SECONDARY_BTN}
                      onClick={() => void copyPairingPayload()}
                    >
                      复制配对 JSON
                    </button>
                    <button
                      type="button"
                      style={SECONDARY_BTN}
                      onClick={() => setPairingVisible(false)}
                    >
                      隐藏
                    </button>
                  </div>

                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                    提示：若手机端与桌面端不在同一局域网，需先把网关暴露到公网 / 内网穿透， 再确保{' '}
                    <code>{pairingQr.hostUrl}</code> 在手机端能直接访问。
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section style={SS}>
        <h3 style={ST}>关于本地配置文件</h3>
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
          桌面端持久化设置文件路径：
        </div>
        <code style={PATH_BOX} title={view.settingsFilePath}>
          {view.settingsFilePath}
        </code>
        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
          系统首次启动若检测到旧位置（<code>%APPDATA%\com.openAwork.desktop\settings.json</code>），
          会自动迁移到上述新位置，无需手动处理。
        </div>
      </section>
    </div>
  );
}
