import { useActionState, useState } from 'react';
import { useNavigate } from 'react-router';
import { Navigate } from 'react-router';
import { useAuthStore } from '../../stores/auth/auth.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { login } from '@openAwork/web-client';
import {
  type DesktopGatewayMode,
  DEFAULT_GATEWAY_PORT,
  desktopGatewayModeForUrl,
  isTauriRuntime,
  localGatewayUrl,
  normalizeGatewayUrl,
  parseGatewayPort,
  readDesktopGatewayMode,
  readGatewayPortFromUrl,
  startDesktopGateway,
  stopDesktopGateway,
  waitForGatewayHealth,
  writeDesktopGatewayMode,
} from '../../utils/gateway/desktop-gateway.js';

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
  const setWebAccess = useAuthStore((s) => s.setWebAccess);
  const webPort = useAuthStore((s) => s.webPort);
  const desktopRuntime = isTauriRuntime();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [gatewayInput, setGatewayInput] = useState(gatewayUrl || 'http://localhost:3000');
  const [gatewayMode, setGatewayMode] = useState<DesktopGatewayMode>(
    () => readDesktopGatewayMode() ?? desktopGatewayModeForUrl(gatewayUrl),
  );
  const [portInput, setPortInput] = useState(
    String(readGatewayPortFromUrl(gatewayUrl, webPort || DEFAULT_GATEWAY_PORT)),
  );
  const [localStatus, setLocalStatus] = useState<'idle' | 'starting' | 'ok' | 'fail'>('idle');
  const [remoteStatus, setRemoteStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // React 19 Actions：表单提交由 useActionState 管理 pending / error，
  // 不再手写 setLoading / setError 三件套。
  const [error, loginAction, isPending] = useActionState<string | null>(async () => {
    try {
      const resolvedUrl = normalizeGatewayUrl(gatewayInput) || gatewayUrl;
      setGatewayUrl(resolvedUrl);
      if (desktopRuntime) {
        const nextMode = desktopGatewayModeForUrl(resolvedUrl);
        setGatewayMode(nextMode);
        writeDesktopGatewayMode(nextMode);
        if (nextMode === 'remote') {
          setWebAccess(false, parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT));
        }
      }
      const data = await login(resolvedUrl, email, password);
      setAuth(data.accessToken, email, data.refreshToken, data.expiresIn);
      void preloadRouteModuleByPath('/chat');
      void navigate('/chat', { replace: true });
      return null;
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
      return isTimeout
        ? '登录超时 — Gateway 响应过慢，请检查服务是否正常运行'
        : err instanceof Error
          ? err.message
          : '网络错误 — Gateway 是否正在运行？';
    }
  }, null);

  if (token) {
    return <Navigate to="/chat" replace />;
  }

  function handleGatewayBlur() {
    const resolvedUrl = normalizeGatewayUrl(gatewayInput);
    setGatewayInput(resolvedUrl);
    setGatewayUrl(resolvedUrl);
    if (desktopRuntime) {
      const nextMode = desktopGatewayModeForUrl(resolvedUrl);
      setGatewayMode(nextMode);
      writeDesktopGatewayMode(nextMode);
    }
  }

  async function handleStartLocalGateway() {
    const port = parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT);
    const localUrl = localGatewayUrl(port);

    setServerError(null);
    setLocalStatus('starting');
    setRemoteStatus('idle');
    setGatewayMode('local');
    setPortInput(String(port));
    setGatewayInput(localUrl);
    setGatewayUrl(localUrl);
    setWebAccess(true, port);
    writeDesktopGatewayMode('local');

    try {
      await startDesktopGateway(port);
      if (!(await waitForGatewayHealth(localUrl))) {
        throw new Error('本地服务端已启动，但健康检查暂未通过');
      }
      setLocalStatus('ok');
    } catch (err: unknown) {
      setLocalStatus('fail');
      setServerError(err instanceof Error ? err.message : '无法启动本地服务端');
    }
  }

  async function handleUseRemoteGateway() {
    const remoteUrl = normalizeGatewayUrl(gatewayInput);
    setGatewayInput(remoteUrl);
    setServerError(null);

    if (!remoteUrl) {
      setRemoteStatus('fail');
      setServerError('请先填写远程服务端地址');
      return;
    }

    setRemoteStatus('testing');
    setLocalStatus('idle');

    try {
      await stopDesktopGateway();
    } catch (err: unknown) {
      console.warn('Failed to stop local desktop gateway before remote login setup', err);
    }

    if (!(await waitForGatewayHealth(remoteUrl))) {
      setRemoteStatus('fail');
      setServerError('远程服务端健康检查失败，请确认地址可访问');
      return;
    }

    setGatewayMode('remote');
    setGatewayUrl(remoteUrl);
    setWebAccess(false, parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT));
    writeDesktopGatewayMode('remote');
    setRemoteStatus('ok');
  }

  return (
    <div className="login-scene">
      {/* Animated background elements */}
      <div className="login-bg-grid" />
      <div className="login-glow login-glow--primary" />
      <div className="login-glow login-glow--secondary" />
      <div className="login-glow login-glow--tertiary" />

      {onToggleTheme && <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />}

      <div className="login-split">
        {/* Left: Hero / Branding */}
        <div className="login-hero">
          <div className="login-hero-content">
            <div className="login-hero-badge">
              <SparkleIcon />
              <span>AI-Powered Workspace</span>
            </div>

            <div className="login-hero-brand">
              <div className="login-hero-logo">
                <AppIcon size={36} />
              </div>
              <h1 className="login-hero-title">OpenAWork</h1>
            </div>

            <p className="login-hero-tagline">
              下一代 AI Agent 工作台
              <br />
              <span className="login-hero-tagline-accent">让智能体为你工作</span>
            </p>

            <div className="login-features">
              <div className="login-feature">
                <div className="login-feature-icon">
                  <AgentIcon />
                </div>
                <div className="login-feature-text">
                  <div className="login-feature-title">多模型 Agent 编排</div>
                  <div className="login-feature-desc">
                    灵活调度 GPT、Claude、本地模型，构建复杂工作流
                  </div>
                </div>
              </div>
              <div className="login-feature">
                <div className="login-feature-icon">
                  <ToolIcon />
                </div>
                <div className="login-feature-text">
                  <div className="login-feature-title">丰富工具生态</div>
                  <div className="login-feature-desc">文件操作、代码执行、网络搜索，一站式集成</div>
                </div>
              </div>
              <div className="login-feature">
                <div className="login-feature-icon">
                  <ShieldIcon />
                </div>
                <div className="login-feature-text">
                  <div className="login-feature-title">本地优先 · 隐私安全</div>
                  <div className="login-feature-desc">
                    数据不离开你的设备，完全掌控你的 AI 工作流
                  </div>
                </div>
              </div>
            </div>

            <div className="login-hero-stats">
              <div className="login-stat">
                <div className="login-stat-value">10+</div>
                <div className="login-stat-label">内置工具</div>
              </div>
              <div className="login-stat-divider" />
              <div className="login-stat">
                <div className="login-stat-value">∞</div>
                <div className="login-stat-label">可能性</div>
              </div>
              <div className="login-stat-divider" />
              <div className="login-stat">
                <div className="login-stat-value">100%</div>
                <div className="login-stat-label">开源</div>
              </div>
            </div>
          </div>

          {/* Decorative floating orbs */}
          <div className="login-orb login-orb--1" />
          <div className="login-orb login-orb--2" />
          <div className="login-orb login-orb--3" />
        </div>

        {/* Right: Login Form */}
        <div className="login-form-side">
          <div className="login-card">
            <div className="login-card-header">
              <h2>欢迎回来</h2>
              <p>登录以继续使用 OpenAWork</p>
            </div>

            <form action={loginAction}>
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
                <div className="login-input-wrapper">
                  <MailIcon />
                  <input
                    id="login-email"
                    className="login-input login-input--icon"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="your@email.com"
                  />
                </div>
              </div>

              <div className="login-field">
                <label className="login-label" htmlFor="login-password">
                  密码
                </label>
                <div className="login-input-wrapper">
                  <LockIcon />
                  <input
                    id="login-password"
                    className="login-input login-input--icon"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </div>
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
                  <div className="login-advanced-panel">
                    {desktopRuntime && (
                      <div className="login-server-mode-grid">
                        <div
                          className={`login-server-card${gatewayMode === 'local' ? ' login-server-card--active' : ''}`}
                        >
                          <div>
                            <div className="login-server-card-title">本地服务端</div>
                            <p className="login-server-card-copy">
                              启动桌面端内置 Gateway，适合单机使用。
                            </p>
                          </div>
                          <label className="login-label" htmlFor="login-local-port">
                            本地端口
                          </label>
                          <input
                            id="login-local-port"
                            className="login-input"
                            type="number"
                            min={1}
                            max={65535}
                            value={portInput}
                            onChange={(e) => setPortInput(e.target.value)}
                          />
                          <button
                            type="button"
                            className="login-server-action"
                            disabled={localStatus === 'starting'}
                            onClick={() => void handleStartLocalGateway()}
                          >
                            {localStatus === 'starting'
                              ? '正在启动…'
                              : localStatus === 'ok'
                                ? '本地已就绪'
                                : '使用本地服务端'}
                          </button>
                        </div>

                        <div
                          className={`login-server-card${gatewayMode === 'remote' ? ' login-server-card--active' : ''}`}
                        >
                          <div>
                            <div className="login-server-card-title">远程服务端</div>
                            <p className="login-server-card-copy">
                              连接团队、NAS 或云端部署的 OpenAWork Gateway。
                            </p>
                          </div>
                          <button
                            type="button"
                            className="login-server-action login-server-action--secondary"
                            disabled={remoteStatus === 'testing'}
                            onClick={() => void handleUseRemoteGateway()}
                          >
                            {remoteStatus === 'testing'
                              ? '正在测试…'
                              : remoteStatus === 'ok'
                                ? '远程已就绪'
                                : remoteStatus === 'fail'
                                  ? '重试远程连接'
                                  : '测试并使用远程'}
                          </button>
                        </div>
                      </div>
                    )}
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
                    <p className="login-advanced-hint">
                      {desktopRuntime
                        ? gatewayMode === 'local'
                          ? '当前使用桌面端内置本地服务端。'
                          : '当前使用远程服务端地址。'
                        : 'API 网关地址，默认 http://localhost:3000'}
                    </p>
                    {serverError && (
                      <div className="login-server-error">
                        <ErrorIcon />
                        <span>{serverError}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isPending || localStatus === 'starting' || remoteStatus === 'testing'}
                className="login-submit-btn"
              >
                <span className="login-btn-shine" />
                {isPending ? (
                  <>
                    <LoadingSpinner />
                    登录中…
                  </>
                ) : (
                  <>
                    登录
                    <ArrowRightIcon />
                  </>
                )}
              </button>
            </form>

            <div className="login-footer">
              <span className="login-footer-dot" />由 OpenAWork 开源社区驱动
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Icon Components ─── */

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
        stroke="currentColor"
        strokeWidth="2.45"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
        transform="rotate(0, 14, 14)"
      />
      <path
        d="M 14,2.6 C 22.75,2.6 25.4,10.5 14,14"
        stroke="currentColor"
        strokeWidth="2.45"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
        transform="rotate(120, 14, 14)"
      />
      <path
        d="M 14,2.6 C 22.75,2.6 25.4,10.5 14,14"
        stroke="currentColor"
        strokeWidth="2.45"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
        transform="rotate(240, 14, 14)"
      />
      <circle cx="14" cy="14" r="2.2" fill="currentColor" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <path d="M6 0l1.5 4.5L12 6l-4.5 1.5L6 12l-1.5-4.5L0 6l4.5-1.5z" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="5" r="3" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
      <circle cx="12" cy="4" r="1.5" />
      <path d="M12 5.5c1.4 0 2.5 1.1 2.5 2.5" />
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.5 2.5l3 3-8.5 8.5H2v-3l8.5-8.5z" />
      <path d="M9 4l3 3" />
      <path d="M2 10l4 4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.5l5 2v4c0 3.5-2.5 5.5-5 6.5-2.5-1-5-3-5-6.5v-4l5-2z" />
      <path d="M6 8l1.5 1.5L10 6.5" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.5" y="3" width="11" height="8" rx="1.5" />
      <path d="M1.5 4.5L7 8l5.5-3.5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="6.5" width="8" height="5.5" rx="1.5" />
      <path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7h8M8 4l3 3-3 3" />
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
