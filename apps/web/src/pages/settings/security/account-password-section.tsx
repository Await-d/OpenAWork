import type { CSSProperties } from 'react';
import { useCallback, useState } from 'react';
import { changePassword } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { logger } from '../../../utils/log/logger.js';
import { BP, IS, SS, ST } from '../shared/settings-section-styles.js';

/**
 * 「安全与权限」→「账号安全」区块：自助修改当前登录账号的密码。
 *
 * 为什么不复用桌面端「Web 端访问」里的改密卡片：那张卡片走的是 Tauri IPC 与
 * `X-OpenAWork-Desktop-Auth` 桌面令牌，浏览器里两个前提都不成立（详见
 * `desktop-web-access-section.tsx`），Docker 部署的网关托管前端时它恒不可用。
 * 本区块只依赖普通登录态（JWT），Web 端与桌面端通用。
 *
 * 两处改密写的是 `users` 表的同一行，所以「这里改的密码」与「桌面端改的密码」是
 * 同一份凭据，不存在两套密码。
 */

/** 与服务端 `changePasswordSchema` / 桌面端改密保持一致的长度约束。 */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const FIELD_LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--fg-default)',
};

const NOTICE_BASE: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  fontSize: 12,
  lineHeight: 1.6,
};

export function AccountPasswordSection() {
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const accessToken = useAuthStore((state) => state.accessToken);
  const email = useAuthStore((state) => state.email);
  const setAuth = useAuthStore((state) => state.setAuth);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = useCallback(() => {
    if (busy) return;
    setError(null);
    setSuccess(null);

    if (currentPassword.length === 0) {
      setError('请输入当前密码。');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`新密码至少 ${MIN_PASSWORD_LENGTH} 位。`);
      return;
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      setError(`新密码不能超过 ${MAX_PASSWORD_LENGTH} 位。`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。');
      return;
    }
    if (newPassword === currentPassword) {
      setError('新密码不能与当前密码相同。');
      return;
    }
    if (!accessToken) {
      setError('登录已失效，请重新登录后再修改密码。');
      return;
    }

    setBusy(true);
    // 刻意不用 try/catch/finally：React Compiler 1.0.0 遇到 finally 子句会让整个
    // 组件脱靶（同 `desktop-web-access-section.tsx` 的约束），故用两参数 then 表达
    // 成败分支。
    void changePassword(gatewayUrl, accessToken, currentPassword, newPassword).then(
      (tokens) => {
        // 服务端改密后作废了该账号的全部 refresh token，必须立刻换上本次返回的新
        // 令牌对——否则当前会话在 access token 过期后无法刷新，等同「改完就被登出」。
        setAuth(tokens.accessToken, email ?? '', tokens.refreshToken, tokens.expiresIn);
        setBusy(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setSuccess('密码已修改，桌面端与 Web 端同时生效。');
      },
      (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : '修改密码失败。');
        logger.error('change_password failed', err);
      },
    );
  }, [
    accessToken,
    busy,
    confirmPassword,
    currentPassword,
    email,
    gatewayUrl,
    newPassword,
    setAuth,
  ]);

  return (
    <section style={SS}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={ST}>账号安全</h3>
        <div style={{ fontSize: 13, color: 'var(--fg-default)', lineHeight: 1.6 }}>
          修改
          <code style={{ fontFamily: 'monospace', padding: '0 4px' }}>{email ?? '当前账号'}</code>
          的登录密码。桌面端与本 Web 端共用同一份密码，任一处置改后另一端同样生效；
          修改成功后其它设备的登录会失效，需要重新登录。
        </div>
      </div>

      <div
        style={{
          borderRadius: 12,
          border: '1px solid var(--border-default)',
          background: 'var(--bg-overlay)',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 10,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={FIELD_LABEL}>当前密码</span>
            <input
              style={IS}
              type="password"
              aria-label="当前密码"
              autoComplete="current-password"
              value={currentPassword}
              disabled={busy}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={FIELD_LABEL}>新密码</span>
            <input
              style={IS}
              type="password"
              aria-label="新密码"
              autoComplete="new-password"
              placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
              value={newPassword}
              disabled={busy}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={FIELD_LABEL}>确认新密码</span>
            <input
              style={IS}
              type="password"
              aria-label="确认新密码"
              autoComplete="new-password"
              value={confirmPassword}
              disabled={busy}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              ...NOTICE_BASE,
              border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
              background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              ...NOTICE_BASE,
              border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
              color: 'var(--accent)',
            }}
          >
            {success}
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            style={{ ...BP, opacity: busy ? 0.4 : 1 }}
          >
            {busy ? '提交中…' : '修改密码'}
          </button>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
            需要提供当前密码；连续失败过多会被临时限流。
          </span>
        </div>
      </div>
    </section>
  );
}
