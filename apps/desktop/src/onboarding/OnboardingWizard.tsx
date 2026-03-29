import React, { useState } from 'react';
import { login as apiLogin } from '@openAwork/web-client';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../../../web/src/stores/auth.js';

const inputStyle: React.CSSProperties = {
  background: 'hsl(var(--muted) / 0.6)',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'hsl(var(--foreground))',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

type Step = 'connect' | 'login';

interface Props {
  onComplete?: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const navigate = useNavigate();
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
      const data = await apiLogin(url, email, password);
      setAuth(data.accessToken, email, data.refreshToken, data.expiresIn);
      localStorage.setItem('onboarded', '1');
      if (onComplete) {
        onComplete();
      } else {
        void navigate('/sessions', { replace: true });
      }
    } catch {
      setLoginError('网络错误 — Gateway 是否正在运行？');
    } finally {
      setLogging(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100dvh',
        background: 'hsl(var(--background))',
      }}
    >
      <div
        style={{
          background: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 16,
          padding: '2rem',
          width: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'hsl(var(--primary))' }}>OpenAWork</h1>
        {step === 'connect' ? (
          <>
            <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
              输入网关地址以连接。
            </p>
            <label
              style={{
                fontSize: 13,
                color: 'hsl(var(--muted-foreground))',
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
                  background: 'hsl(var(--primary) / 0.15)',
                  color: 'hsl(var(--primary))',
                  border: '1px solid hsl(var(--primary) / 0.3)',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 13,
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
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                  border: 'none',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: testStatus !== 'ok' ? 'not-allowed' : 'pointer',
                  opacity: testStatus !== 'ok' ? 0.5 : 1,
                }}
              >
                继续
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              void handleLogin(e);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>登录您的账号。</p>
            {loginError && (
              <div
                style={{
                  background: 'hsl(var(--destructive) / 0.1)',
                  border: '1px solid hsl(var(--destructive) / 0.3)',
                  borderRadius: 6,
                  padding: '0.5rem 0.75rem',
                  color: 'hsl(var(--destructive))',
                  fontSize: 13,
                }}
              >
                {loginError}
              </div>
            )}
            <label
              style={{
                fontSize: 13,
                color: 'hsl(var(--muted-foreground))',
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
                fontSize: 13,
                color: 'hsl(var(--muted-foreground))',
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
                  color: 'hsl(var(--muted-foreground))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 13,
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
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                  border: 'none',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: logging ? 'not-allowed' : 'pointer',
                  opacity: logging ? 0.7 : 1,
                }}
              >
                {logging ? '登录中…' : '登录'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
