import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { Navigate } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { preloadRouteModuleByPath } from '../routes/preloadable-route-modules.js';
import { login } from '@openAwork/web-client';

interface LoginPageProps {
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

export default function LoginPage({ theme, onToggleTheme }: LoginPageProps = {}) {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const setGatewayUrl = useAuthStore((s) => s.setGatewayUrl);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [gatewayInput, setGatewayInput] = useState(gatewayUrl || 'http://localhost:3000');
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (token) {
    return <Navigate to="/chat" replace />;
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resolvedUrl = gatewayInput.trim().replace(/\/$/, '') || gatewayUrl;
      setGatewayUrl(resolvedUrl);
      const data = await login(resolvedUrl, email, password);
      setAuth(data.accessToken, email, data.refreshToken, data.expiresIn);
      void preloadRouteModuleByPath('/chat');
      void navigate('/chat', { replace: true });
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
      setError(
        isTimeout
          ? '登录超时 — Gateway 响应过慢，请检查服务是否正常运行'
          : err instanceof Error
            ? err.message
            : '网络错误 — Gateway 是否正在运行？',
      );
    } finally {
      setLoading(false);
    }
  }

  function handleGatewayBlur() {
    setGatewayUrl(gatewayInput.trim().replace(/\/$/, ''));
  }

  return (
    <div className="login-scene">
      <div className="login-glow login-glow--primary" />
      <div className="login-glow login-glow--secondary" />

      {onToggleTheme && <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />}

      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-icon">
            <AppIcon size={28} />
          </div>
          <div className="login-brand-title">OpenAWork</div>
          <p className="login-brand-subtitle">AI Agent Workbench</p>
        </div>

        <div className="login-heading">
          <h2>欢迎回来</h2>
          <p>登录以继续使用</p>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          {error && (
            <div className="login-error">
              <ErrorIcon />
              <span>{error}</span>
            </div>
          )}

          <div className="login-field">
            <label className="login-label" htmlFor="login-email">
              邮箱
            </label>
            <input
              id="login-email"
              className="login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="your@email.com"
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="login-password">
              密码
            </label>
            <input
              id="login-password"
              className="login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </div>

          <div className="login-field">
            <button
              type="button"
              className="login-advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <ChevronIcon expanded={showAdvanced} />
              服务器设置
            </button>

            {showAdvanced && (
              <div>
                <label className="login-label" htmlFor="login-gateway">
                  Gateway 地址
                </label>
                <input
                  id="login-gateway"
                  className="login-input"
                  type="url"
                  value={gatewayInput}
                  onChange={(e) => setGatewayInput(e.target.value)}
                  onBlur={handleGatewayBlur}
                  placeholder="http://localhost:3000"
                  autoComplete="url"
                />
                <p className="login-advanced-hint">API 网关地址，默认 http://localhost:3000</p>
              </div>
            )}
          </div>

          <button type="submit" disabled={loading} className="login-submit-btn">
            <span className="login-btn-shine" />
            {loading ? (
              <>
                <LoadingSpinner />
                登录中…
              </>
            ) : (
              '登录'
            )}
          </button>
        </form>

        <div className="login-footer">由 OpenAWork 驱动</div>
      </div>
    </div>
  );
}

function AppIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M 14,2.6 C 22.75,2.6 25.4,10.5 14,14"
        stroke="white"
        strokeWidth="2.45"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
        transform="rotate(0, 14, 14)"
      />
      <path
        d="M 14,2.6 C 22.75,2.6 25.4,10.5 14,14"
        stroke="white"
        strokeWidth="2.45"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
        transform="rotate(120, 14, 14)"
      />
      <path
        d="M 14,2.6 C 22.75,2.6 25.4,10.5 14,14"
        stroke="white"
        strokeWidth="2.45"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
        transform="rotate(240, 14, 14)"
      />
      <circle cx="14" cy="14" r="2.2" fill="white" />
    </svg>
  );
}

function ThemeToggle({
  theme,
  onToggleTheme,
}: {
  theme?: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  return (
    <button
      type="button"
      className="login-theme-btn"
      onClick={onToggleTheme}
      title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="7.5" cy="7.5" r="2.5" />
      <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.9 2.9l1.1 1.1M11 11l1.1 1.1M2.9 12.1l1.1-1.1M11 4l1.1-1.1" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 9A5.5 5.5 0 0 1 6 2.5a5.5 5.5 0 1 0 6.5 6.5z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={{ flexShrink: 0, marginTop: 1 }}
    >
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM7.25 5a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0V5ZM8 10.5A.75.75 0 1 1 8 12a.75.75 0 0 1 0-1.5Z" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
    >
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <path d="M7 1a6 6 0 0 1 6 6" />
    </svg>
  );
}
