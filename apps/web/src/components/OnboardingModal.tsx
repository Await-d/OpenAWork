import React, { useState } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { login } from '@openAwork/web-client';
import { PairingPanel, OAuthButton } from '@openAwork/shared-ui';
import { logger } from '../utils/logger.js';
import type { PairingMode } from '@openAwork/shared-ui';

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

type Step = 'connect' | 'login' | 'pairing';

interface Props {
  onComplete: () => void;
}

export default function OnboardingModal({ onComplete }: Props) {
  const { gatewayUrl, setGatewayUrl, setAuth } = useAuthStore();
  const [urlInput, setUrlInput] = useState(gatewayUrl);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [step, setStep] = useState<Step>('connect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);

  async function testConnection() {
    setTestStatus('testing');
    const url = urlInput.trim().replace(/\/$/, '');
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      setTestStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setTestStatus('fail');
    }
  }

  function saveAndContinue() {
    setGatewayUrl(urlInput.trim().replace(/\/$/, ''));
    setStep('login');
  }

  async function handleLogin(e: React.SyntheticEvent) {
    e.preventDefault();
    setLoginError(null);
    setLogging(true);
    const url = urlInput.trim().replace(/\/$/, '');
    try {
      const data = await login(url, email, password);
      setAuth(data.accessToken, email, data.refreshToken, data.expiresIn);
      localStorage.setItem('onboarded', '1');
      onComplete();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '网络错误 — Gateway 是否正在运行？');
    } finally {
      setLogging(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'oklch(0 0 0 / 0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '2rem',
          width: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <button
          type="button"
          onClick={onComplete}
          aria-label="关闭引导"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 28,
            height: 28,
            borderRadius: 6,
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background 150ms ease, color 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--surface-hover)';
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-3)';
          }}
        >
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>OpenAWork</h1>
        {step === 'connect' ? (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-3)' }}>输入网关地址以连接。</p>
            <label
              style={{
                fontSize: 12,
                color: 'var(--text-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              网关地址
              <input
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  setTestStatus('idle');
                }}
                placeholder="http://localhost:3000"
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => void testConnection()}
                style={{
                  flex: 1,
                  background: 'var(--accent-muted)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent-muted)',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {testStatus === 'testing'
                  ? '测试中…'
                  : testStatus === 'ok'
                    ? '已连接'
                    : testStatus === 'fail'
                      ? '失败 — 重试'
                      : '测试连接'}
              </button>
              <button
                type="button"
                onClick={saveAndContinue}
                disabled={testStatus !== 'ok'}
                style={{
                  flex: 1,
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: testStatus !== 'ok' ? 'not-allowed' : 'pointer',
                  opacity: testStatus !== 'ok' ? 0.5 : 1,
                }}
              >
                继续
              </button>
            </div>
            <button
              type="button"
              onClick={onComplete}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-3)',
                fontSize: 12,
                cursor: 'pointer',
                alignSelf: 'center',
                marginTop: '0.25rem',
                transition: 'color 150ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-3)';
              }}
            >
              跳过引导，直接登录
            </button>
          </>
        ) : step === 'login' ? (
          <form
            onSubmit={(e) => {
              void handleLogin(e);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <p style={{ fontSize: 12, color: 'var(--text-3)' }}>登录您的账号。</p>
            <OAuthButton
              providerName="GitHub"
              isAuthorized={false}
              onAuthorize={() => logger.info('OAuth: GitHub authorize triggered')}
              onRevoke={() => {}}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0.5rem 0' }}>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>或使用邮箱</span>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
            </div>
            {loginError && (
              <div
                style={{
                  background: 'oklch(from var(--danger) l c h / 0.1)',
                  border: '1px solid oklch(from var(--danger) l c h / 0.3)',
                  borderRadius: 6,
                  padding: '0.5rem 0.75rem',
                  color: 'var(--danger)',
                  fontSize: 12,
                }}
              >
                {loginError}
              </div>
            )}
            <label
              style={{
                fontSize: 12,
                color: 'var(--text-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              邮箱
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={inputStyle}
              />
            </label>
            <label
              style={{
                fontSize: 12,
                color: 'var(--text-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStep('connect')}
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: 'var(--text-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                返回
              </button>
              <button
                type="submit"
                disabled={logging}
                style={{
                  flex: 1,
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: logging ? 'not-allowed' : 'pointer',
                  opacity: logging ? 0.7 : 1,
                }}
              >
                {logging ? '登录中…' : '登录'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setStep('pairing')}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-3)',
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
                marginTop: '0.25rem',
                alignSelf: 'center',
              }}
            >
              设备配对（可选）
            </button>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ fontSize: 12, color: 'var(--text-3)' }}>将另一台设备与此工作区配对。</p>
            <PairingPanel
              mode="host"
              host={{
                qrData: 'openAwork-pair://localhost:3000?token=DEMO',
                expiresAt: Date.now() + 30000,
                pairedDevices: [],
                onRefreshToken: () => {},
                onDisconnect: () => {},
              }}
              client={{ onScanned: () => {}, onManualCode: () => {} }}
              onModeChange={(_mode: PairingMode) => {}}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStep('login')}
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: 'var(--text-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                返回
              </button>
              <button
                type="button"
                onClick={onComplete}
                style={{
                  flex: 1,
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                跳过
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
