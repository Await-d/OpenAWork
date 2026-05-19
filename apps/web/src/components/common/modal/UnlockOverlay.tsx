import { useCallback, useEffect, useRef, useState } from 'react';
import { PinInput } from './PinInput.js';
import { tauriInvoke } from '../../../pages/settings/shared/settings-page-helpers.js';
import { logger } from '../../../utils/log/logger.js';

interface VerifyPinResult {
  ok: boolean;
  lockoutSeconds: number;
  attemptsRemaining: number;
}

function formatLockoutHint(secs: number): string {
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  if (mins > 0) {
    return `${mins} 分 ${s.toString().padStart(2, '0')} 秒`;
  }
  return `${secs} 秒`;
}

/**
 * 全屏锁屏遮罩——仅在桌面端 + 已设 PIN + 当前 locked 时由 App 渲染。
 *
 * 触发场景：
 * - 应用启动后（若已设 PIN）；
 * - 隐藏到托盘后再次显示主窗口（Rust 端会 emit `lock-state-changed`）。
 *
 * 解锁流程：调 `verify_desktop_pin`，成功后 Rust 端会 emit 事件解锁；
 * 此组件不需要主动设置上层的 locked 状态，由 App 监听事件统一管理。
 */
const DEFAULT_PIN_DIGITS = 6;

export function UnlockOverlay({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [pinDigits, setPinDigits] = useState(DEFAULT_PIN_DIGITS);
  const loadedRef = useRef(false);

  // 从 Rust 读 PIN 长度，确保解锁界面格子数与设置界面完全一致。
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void tauriInvoke<{ pinDigits: number }>('get_desktop_settings')
      .then((s) => setPinDigits(s.pinDigits ?? DEFAULT_PIN_DIGITS))
      .catch(() => undefined);
  }, []);

  // 锁死倒计时每秒 -1；归零时自动恢复可输入态。
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          setError(null);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  const submit = useCallback(
    async (value: string) => {
      if (verifying || lockoutSeconds > 0) return;
      setVerifying(true);
      setError(null);
      try {
        const result = await tauriInvoke<VerifyPinResult>('verify_desktop_pin', { pin: value });
        if (result.ok) {
          setPin('');
          onUnlocked();
        } else if (result.lockoutSeconds > 0) {
          setLockoutSeconds(result.lockoutSeconds);
          setPin('');
          setError(`尝试次数过多，已锁定 ${formatLockoutHint(result.lockoutSeconds)}`);
        } else {
          setError(`PIN 不正确，还可尝试 ${result.attemptsRemaining} 次`);
          setPin('');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        logger.error('verify_desktop_pin failed', err);
      } finally {
        setVerifying(false);
      }
    },
    [lockoutSeconds, onUnlocked, verifying],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="解锁 OpenAWork"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'color-mix(in srgb, var(--bg-base) 96%, black)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          padding: '40px 32px',
          borderRadius: 16,
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-subtle)',
          minWidth: 360,
          maxWidth: 420,
          boxShadow: '0 24px 60px -16px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'color-mix(in srgb, var(--accent) 14%, var(--bg-overlay))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
          }}
        >
          🔒
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)', marginBottom: 6 }}>
            OpenAWork 已锁定
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
            请输入解锁 PIN 继续使用
          </div>
        </div>

        <PinInput
          value={pin}
          length={pinDigits}
          onChange={(next) => {
            setPin(next);
            if (lockoutSeconds === 0) setError(null);
          }}
          onComplete={(value) => void submit(value)}
          autoFocus
          disabled={verifying || lockoutSeconds > 0}
          error={!!error}
          ariaLabel="PIN 输入"
        />

        <div style={{ minHeight: 18, fontSize: 12, color: 'var(--danger))' }}>
          {lockoutSeconds > 0 ? (
            <span>已锁定，剩余 {formatLockoutHint(lockoutSeconds)}</span>
          ) : error ? (
            error
          ) : verifying ? (
            <span style={{ color: 'var(--fg-muted)' }}>验证中…</span>
          ) : null}
        </div>

        <div style={{ fontSize: 10, color: 'var(--fg-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          忘记 PIN？请在桌面端可用时进入「设置 → 桌面端 → 解锁 PIN」， 或手动删除{' '}
          <code>~/.openAwork/desktop-settings.json</code> 中的 <code>pinHash</code> 字段。
        </div>
      </div>
    </div>
  );
}
