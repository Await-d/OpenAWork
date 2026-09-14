import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriInvoke } from '../../../pages/settings/shared/settings-page-helpers.js';
import { isTauriRuntime } from '../../../utils/gateway/desktop-gateway.js';
import { listenTauriEvent, type UnlistenFn } from '../../../utils/tauri/tauri-events.js';
import { logger } from '../../../utils/log/logger.js';
import { AppDialog, DialogActionButton, DialogError, DialogIconBadge } from './AppDialog.js';

/** Rust 端在「关闭行为 = 每次询问」时 emit 的事件名（见 lib.rs 的 EVT_CLOSE_REQUESTED）。 */
const EVT_CLOSE_REQUESTED = 'desktop:close-requested';

/** 关闭动作，与 Rust `resolve_close_request` 的 action 参数一一对应。 */
type CloseAction = 'minimize' | 'exit';

function PowerIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v8.5" />
      <path d="M7.3 6.5a7.2 7.2 0 1 0 9.4 0" />
    </svg>
  );
}

function TrayIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 19h14" />
    </svg>
  );
}

/** 一条「动作 → 后果」说明行，左侧色点区分动作语义。 */
function ConsequenceRow({
  tone,
  label,
  description,
}: {
  tone: 'accent' | 'danger';
  label: string;
  description: string;
}) {
  const dotColor = tone === 'danger' ? 'var(--danger)' : 'var(--accent)';
  const dotHalo = tone === 'danger' ? 'var(--danger-muted)' : 'var(--accent-muted)';
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span
        aria-hidden
        style={{
          marginTop: 6,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: dotColor,
          boxShadow: `0 0 0 3px ${dotHalo}`,
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>{label}</div>
        <div style={{ marginTop: 2, fontSize: 11.5, lineHeight: 1.6, color: 'var(--fg-muted)' }}>
          {description}
        </div>
      </div>
    </div>
  );
}

/** 「记住我的选择」勾选项，勾选后把本次动作写回 close_behavior。 */
function RememberChoice({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      title="可在「设置 → 桌面端 → 关闭行为」中随时修改"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        cursor: disabled ? 'default' : 'pointer',
        userSelect: 'none',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{
          width: 14,
          height: 14,
          margin: 0,
          cursor: disabled ? 'default' : 'pointer',
          accentColor: 'var(--accent)',
        }}
      />
      <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>记住我的选择，下次不再询问</span>
    </label>
  );
}

/**
 * 桌面端关闭确认弹窗。
 *
 * 取代原先的系统原生 `MessageDialog`：Rust 端在关闭行为为「每次询问」时
 * prevent_close 并 emit `desktop:close-requested`，这里收到后渲染应用内弹窗，
 * 用户选择通过 `resolve_close_request` 回执（exit / minimize）。
 *
 * 行为约定（外壳、Esc、遮罩、右上角 X 由 AppDialog 统一提供）：
 * - 右上角 X / Esc / 点击遮罩一律视为「取消」——只收起弹窗，**不做任何动作**，
 *   窗口与 gateway 保持原样；只有两个动作按钮才会真正改变程序状态；
 * - 「记住我的选择」把本次动作写回 `close_behavior`，下次点 X 直接执行。
 *
 * 仅在 Tauri 桌面端渲染，浏览器环境直接返回 null。
 */
export function CloseConfirmDialog() {
  const desktopRuntime = isTauriRuntime();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<CloseAction | null>(null);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  // 注册监听 → **成功后**再告知 Rust 端「应用内弹窗已就绪」。
  //
  // 顺序不能颠倒：Rust 端一旦看到 ready 就把点 X 的行为交给自定义弹窗，
  // 若此时监听还没注册上，emit 出去没人接，用户点 X 会毫无反应。
  // 监听失败时保持未就绪，Rust 会自动回落到系统原生对话框。
  useEffect(() => {
    if (!desktopRuntime) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const fn = await listenTauriEvent<void>(EVT_CLOSE_REQUESTED, () => {
          setBusy(null);
          setError(null);
          setRemember(false);
          setOpen(true);
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        await tauriInvoke('mark_desktop_ui_ready').catch((err: unknown) => {
          logger.warn('mark_desktop_ui_ready failed', err);
        });
      } catch (err) {
        logger.error('listen desktop:close-requested failed', err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktopRuntime]);

  const resolve = useCallback(
    async (action: CloseAction) => {
      if (busy) return;
      setBusy(action);
      setError(null);
      // 乐观收起：退出会直接终止进程、最小化会隐藏窗口，都不必等 Rust 回执；
      // 只有调用失败时才带错误信息把弹窗重新拉起来。
      setOpen(false);
      try {
        await tauriInvoke('resolve_close_request', { action, remember });
      } catch (err) {
        logger.error('resolve_close_request failed', err);
        setError(err instanceof Error ? err.message : String(err));
        setOpen(true);
      } finally {
        setBusy(null);
      }
    },
    [busy, remember],
  );

  /**
   * 取消：只收起弹窗，**不向 Rust 回执任何动作**。
   *
   * 窗口保持原样（既不退出也不隐藏）。点窗口 X 只是「问了一下、又反悔了」，
   * 不应该替用户做「最小化到托盘」这个真实的状态变更。
   */
  const dismiss = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  if (!desktopRuntime || !open) return null;

  const disabled = busy !== null;

  return (
    <AppDialog
      badge={
        <DialogIconBadge>
          <PowerIcon />
        </DialogIconBadge>
      }
      title="关闭 OpenAWork"
      description="请选择关闭方式，本地 gateway 会随「退出程序」一起停止。"
      onDismiss={dismiss}
      initialFocusRef={primaryRef}
      footerLeft={<RememberChoice checked={remember} disabled={disabled} onChange={setRemember} />}
      footerRight={
        <>
          <DialogActionButton
            variant="secondary"
            icon={<TrayIcon />}
            label={busy === 'minimize' ? '正在最小化…' : '最小化到托盘'}
            disabled={disabled}
            onClick={() => void resolve('minimize')}
          />
          <DialogActionButton
            buttonRef={primaryRef}
            variant="primary"
            icon={<PowerIcon size={15} />}
            label={busy === 'exit' ? '正在退出…' : '退出程序'}
            disabled={disabled}
            onClick={() => void resolve('exit')}
          />
        </>
      }
    >
      <ConsequenceRow
        tone="accent"
        label="最小化到托盘"
        description="应用继续在后台运行，本地 gateway 保持在线，可随时点击托盘图标唤醒。"
      />
      <ConsequenceRow
        tone="danger"
        label="退出程序"
        description="结束当前会话并停止本地 gateway 进程，下次需要重新启动。"
      />
      {error ? <DialogError message={error} /> : null}
    </AppDialog>
  );
}
