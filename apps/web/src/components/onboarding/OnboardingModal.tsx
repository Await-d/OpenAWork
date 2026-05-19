import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/auth/auth.js';
import { getPairingQr, login, type PairingQrResponse } from '@openAwork/web-client';
import { PairingPanel, OAuthButton } from '@openAwork/shared-ui';
import { logger } from '../../utils/log/logger.js';
import type { PairingMode } from '@openAwork/shared-ui';
import {
  type DesktopGatewayMode,
  authenticateDesktopGateway,
  DEFAULT_GATEWAY_PORT,
  DESKTOP_DEFAULT_EMAIL,
  isGatewayHealthy,
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

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

type Step = 'mode' | 'connect' | 'login' | 'pairing';
type LocalStatus = 'idle' | 'starting' | 'ok' | 'fail';

interface Props {
  onComplete: () => void;
}

type DesktopOnboardingStep = 'mode' | 'connect';
type DesktopRemoteStatus = 'idle' | 'testing' | 'ok' | 'fail';

export default function OnboardingModal(props: Props) {
  if (isTauriRuntime()) {
    return <DesktopGatewayOnboarding {...props} />;
  }

  return <BrowserOnboardingModal {...props} />;
}

function DesktopGatewayOnboarding({ onComplete }: Props) {
  const { gatewayUrl, setGatewayUrl, setAuth, setWebAccess, webPort } = useAuthStore();
  const initialPort = readGatewayPortFromUrl(gatewayUrl, webPort || DEFAULT_GATEWAY_PORT);
  const [step, setStep] = useState<DesktopOnboardingStep>('mode');
  const [urlInput, setUrlInput] = useState(gatewayUrl);
  const [portInput, setPortInput] = useState(String(initialPort));
  const [localStatus, setLocalStatus] = useState<LocalStatus>('idle');
  const [remoteStatus, setRemoteStatus] = useState<DesktopRemoteStatus>('idle');
  const [remoteEmail, setRemoteEmail] = useState(DESKTOP_DEFAULT_EMAIL);
  const [remotePassword, setRemotePassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  function completeDesktopOnboarding(
    url: string,
    mode: DesktopGatewayMode,
    port: number,
    tokenPair: { accessToken: string; refreshToken?: string; expiresIn?: string },
    email: string,
  ) {
    setAuth(tokenPair.accessToken, email, tokenPair.refreshToken, tokenPair.expiresIn);
    setGatewayUrl(url);
    setWebAccess(mode === 'local', port);
    writeDesktopGatewayMode(mode);
    localStorage.setItem('onboarded', '1');
    onComplete();
  }

  async function completeLocalDesktopOnboarding(url: string, port: number) {
    const tokenPair = await authenticateDesktopGateway(url);
    completeDesktopOnboarding(url, 'local', port, tokenPair, DESKTOP_DEFAULT_EMAIL);
  }

  async function chooseLocalGateway() {
    const port = parseGatewayPort(portInput, DEFAULT_GATEWAY_PORT);
    const url = localGatewayUrl(port);

    setLocalStatus('starting');
    setRemoteStatus('idle');
    setError(null);
    setPortInput(String(port));
    setUrlInput(url);

    try {
      await startDesktopGateway(port);
      if (!(await waitForGatewayHealth(url))) {
        throw new Error('本地网关已启动，但健康检查暂未通过');
      }

      setLocalStatus('ok');
      await completeLocalDesktopOnboarding(url, port);
    } catch (eventualError: unknown) {
      setLocalStatus('fail');
      setError(eventualError instanceof Error ? eventualError.message : '无法启动本地网关');
    }
  }

  function chooseRemoteGateway() {
    setLocalStatus('idle');
    setRemoteStatus('idle');
    setError(null);
    writeDesktopGatewayMode('remote');
    setWebAccess(false, parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT));
    setStep('connect');

    void stopDesktopGateway().catch((eventualError: unknown) => {
      logger.warn('Failed to stop local desktop gateway before remote setup', eventualError);
    });
  }

  async function connectRemoteGateway() {
    const url = normalizeGatewayUrl(urlInput);
    const port = parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT);
    setUrlInput(url);
    setError(null);

    if (!url) {
      setRemoteStatus('fail');
      setError('请先填写远程网关地址');
      return;
    }
    if (!remoteEmail || !remotePassword) {
      setRemoteStatus('fail');
      setError('请填写远程网关管理员邮箱和密码');
      return;
    }

    setRemoteStatus('testing');
    try {
      if (!(await waitForGatewayHealth(url))) {
        throw new Error('远程网关健康检查失败，请确认地址可访问');
      }

      const tokenPair = await login(url, remoteEmail, remotePassword);
      setRemoteStatus('ok');
      completeDesktopOnboarding(url, 'remote', port, tokenPair, remoteEmail);
    } catch (eventualError: unknown) {
      setRemoteStatus('fail');
      setError(eventualError instanceof Error ? eventualError.message : '无法连接远程网关');
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default)',
          borderRadius: 16,
          padding: '2rem',
          width: step === 'mode' ? 680 : 420,
          maxWidth: 'calc(100vw - 32px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', margin: 0 }}>
          OpenAWork Desktop
        </h1>
        <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: 0, lineHeight: 1.6 }}>
          桌面端会使用默认本地身份进入工作台。首次启动只需要选择网关来源，后续可在设置中切换。
        </p>

        {step === 'mode' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: 12,
            }}
          >
            <section
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                minHeight: 230,
                padding: 16,
                border: '1px solid var(--accent-muted)',
                borderRadius: 14,
                background: 'var(--accent-muted)',
              }}
            >
              <strong style={{ fontSize: 15, color: 'var(--fg-strong)' }}>使用本地网关</strong>
              <span style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.55 }}>
                适合单机使用。桌面端会启动内置 Gateway，并自动进入工作台。
              </span>
              <label
                style={{
                  fontSize: 12,
                  color: 'var(--fg-muted)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                本地端口
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={portInput}
                  onChange={(event) => setPortInput(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <button
                type="button"
                onClick={() => void chooseLocalGateway()}
                disabled={localStatus === 'starting'}
                style={{
                  marginTop: 'auto',
                  background: 'var(--accent)',
                  color: 'var(--fg-on-accent)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '0.7rem',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: localStatus === 'starting' ? 'not-allowed' : 'pointer',
                  opacity: localStatus === 'starting' ? 0.72 : 1,
                }}
              >
                {localStatus === 'starting'
                  ? '正在启动并进入…'
                  : localStatus === 'ok'
                    ? '本地网关已就绪'
                    : '使用本地网关'}
              </button>
            </section>

            <section
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                minHeight: 230,
                padding: 16,
                border: '1px solid var(--border-default)',
                borderRadius: 14,
                background: 'var(--bg-hover)',
              }}
            >
              <strong style={{ fontSize: 15, color: 'var(--fg-strong)' }}>连接远程网关</strong>
              <span style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.55 }}>
                适合连接团队服务器、NAS、云端部署或已经运行的 OpenAWork Gateway。
              </span>
              <button
                type="button"
                onClick={chooseRemoteGateway}
                style={{
                  marginTop: 'auto',
                  background: 'transparent',
                  color: 'var(--fg-strong)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 8,
                  padding: '0.7rem',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                输入远程网关地址
              </button>
            </section>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label
              style={{
                fontSize: 12,
                color: 'var(--fg-muted)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              远程网关地址
              <input
                type="url"
                value={urlInput}
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  setRemoteStatus('idle');
                }}
                placeholder="https://gateway.example.com"
                style={inputStyle}
              />
            </label>
            <label
              style={{
                fontSize: 12,
                color: 'var(--fg-muted)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              管理员邮箱
              <input
                type="email"
                value={remoteEmail}
                onChange={(event) => setRemoteEmail(event.target.value)}
                autoComplete="username"
                placeholder={DESKTOP_DEFAULT_EMAIL}
                style={inputStyle}
              />
            </label>
            <label
              style={{
                fontSize: 12,
                color: 'var(--fg-muted)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              管理员密码
              <input
                type="password"
                value={remotePassword}
                onChange={(event) => setRemotePassword(event.target.value)}
                autoComplete="current-password"
                placeholder="远程 Gateway 管理员密码"
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStep('mode')}
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  border: '1px solid var(--border-default)',
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
                onClick={() => void connectRemoteGateway()}
                disabled={remoteStatus === 'testing'}
                style={{
                  flex: 1,
                  background: 'var(--accent)',
                  color: 'var(--fg-on-accent)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '0.6rem',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: remoteStatus === 'testing' ? 'not-allowed' : 'pointer',
                  opacity: remoteStatus === 'testing' ? 0.72 : 1,
                }}
              >
                {remoteStatus === 'testing'
                  ? '正在连接并进入…'
                  : remoteStatus === 'ok'
                    ? '远程网关已就绪'
                    : '连接并进入'}
              </button>
            </div>
          </div>
        )}

        {error ? <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{error}</p> : null}
      </div>
    </div>
  );
}

function BrowserOnboardingModal({ onComplete }: Props) {
  const desktopRuntime = isTauriRuntime();
  const { accessToken, gatewayUrl, setGatewayUrl, setAuth, setWebAccess, webPort } = useAuthStore();
  const initialPort = readGatewayPortFromUrl(gatewayUrl, webPort || DEFAULT_GATEWAY_PORT);
  const [mode, setMode] = useState<DesktopGatewayMode | null>(() => readDesktopGatewayMode());
  const [urlInput, setUrlInput] = useState(gatewayUrl);
  const [portInput, setPortInput] = useState(String(initialPort));
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [localStatus, setLocalStatus] = useState<LocalStatus>('idle');
  const [localError, setLocalError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(() => (desktopRuntime ? 'mode' : 'connect'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [pairingQr, setPairingQr] = useState<PairingQrResponse | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  useEffect(() => {
    if (step !== 'pairing') {
      return;
    }

    let cancelled = false;
    const url = normalizeGatewayUrl(urlInput);
    setPairingLoading(true);
    setPairingError(null);
    void getPairingQr(url, accessToken ?? undefined)
      .then((data) => {
        if (!cancelled) {
          setPairingQr(data);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPairingError(error instanceof Error ? error.message : '无法加载配对二维码');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPairingLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, step, urlInput]);

  async function testConnection() {
    setTestStatus('testing');
    const url = normalizeGatewayUrl(urlInput);
    setUrlInput(url);
    if (!url) {
      setTestStatus('fail');
      return;
    }

    setTestStatus((await isGatewayHealthy(url)) ? 'ok' : 'fail');
  }

  function saveAndContinue() {
    const url = normalizeGatewayUrl(urlInput);
    setGatewayUrl(url);
    if (desktopRuntime) {
      setMode('remote');
      writeDesktopGatewayMode('remote');
      setWebAccess(false, parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT));
    }
    setStep('login');
  }

  async function chooseLocalGateway() {
    const port = parseGatewayPort(portInput, DEFAULT_GATEWAY_PORT);
    const url = localGatewayUrl(port);

    setMode('local');
    writeDesktopGatewayMode('local');
    setPortInput(String(port));
    setUrlInput(url);
    setGatewayUrl(url);
    setWebAccess(true, port);
    setLocalStatus('starting');
    setLocalError(null);
    setLoginError(null);
    setTestStatus('idle');

    try {
      await startDesktopGateway(port);
      if (!(await waitForGatewayHealth(url))) {
        throw new Error('本地服务端已启动，但健康检查暂未通过');
      }

      setLocalStatus('ok');
      setStep('login');
    } catch (error: unknown) {
      setLocalStatus('fail');
      setLocalError(error instanceof Error ? error.message : '无法启动本地服务端');
    }
  }

  function chooseRemoteGateway() {
    setMode('remote');
    writeDesktopGatewayMode('remote');
    setWebAccess(false, parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT));
    setLocalStatus('idle');
    setLocalError(null);
    setLoginError(null);
    setTestStatus('idle');
    setStep('connect');

    void stopDesktopGateway().catch((error: unknown) => {
      logger.warn('Failed to stop local desktop gateway before remote setup', error);
    });
  }

  async function handleLogin(e: React.SyntheticEvent) {
    e.preventDefault();
    setLoginError(null);
    setLogging(true);
    const url = normalizeGatewayUrl(urlInput);
    try {
      const data = await login(url, email, password);
      setAuth(data.accessToken, email, data.refreshToken, data.expiresIn);
      localStorage.setItem('onboarded', '1');
      if (desktopRuntime && mode) {
        writeDesktopGatewayMode(mode);
      }
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
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default)',
          borderRadius: 16,
          padding: '2rem',
          width: step === 'mode' ? 680 : 400,
          maxWidth: 'calc(100vw - 32px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {desktopRuntime && step === 'mode' ? null : (
          <button
            type="button"
            onClick={onComplete}
            aria-label="关闭引导"
            className="ui-hover-text-bg"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--border-default)',
              color: 'var(--fg-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
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
        )}
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>OpenAWork</h1>
        {step === 'mode' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: 0 }}>
              首次启动桌面端时，请选择服务端连接方式。
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: 12,
              }}
            >
              <section
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  minHeight: 230,
                  padding: 16,
                  border: '1px solid var(--accent-muted)',
                  borderRadius: 14,
                  background: 'var(--accent-muted)',
                }}
              >
                <strong style={{ fontSize: 15, color: 'var(--fg-strong)' }}>启动本地服务端</strong>
                <span style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.55 }}>
                  适合单机使用。桌面端会启动内置 Gateway，并自动连接到本机地址。
                </span>
                <label
                  style={{
                    fontSize: 12,
                    color: 'var(--fg-muted)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  本地端口
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={portInput}
                    onChange={(e) => setPortInput(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                {localError ? (
                  <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{localError}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void chooseLocalGateway()}
                  disabled={localStatus === 'starting'}
                  style={{
                    marginTop: 'auto',
                    background: 'var(--accent)',
                    color: 'var(--fg-on-accent)',
                    border: 'none',
                    borderRadius: 8,
                    padding: '0.7rem',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: localStatus === 'starting' ? 'not-allowed' : 'pointer',
                    opacity: localStatus === 'starting' ? 0.72 : 1,
                  }}
                >
                  {localStatus === 'starting'
                    ? '正在启动本地服务端…'
                    : localStatus === 'ok'
                      ? '本地服务端已启动'
                      : '使用本地服务端'}
                </button>
              </section>

              <section
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  minHeight: 230,
                  padding: 16,
                  border: '1px solid var(--border-default)',
                  borderRadius: 14,
                  background: 'var(--bg-hover)',
                }}
              >
                <strong style={{ fontSize: 15, color: 'var(--fg-strong)' }}>连接远程服务端</strong>
                <span style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.55 }}>
                  适合连接团队服务器、NAS、云端部署或已经运行的 OpenAWork Gateway。
                </span>
                <button
                  type="button"
                  onClick={chooseRemoteGateway}
                  style={{
                    marginTop: 'auto',
                    background: 'transparent',
                    color: 'var(--fg-strong)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 8,
                    padding: '0.7rem',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  输入远程服务端地址
                </button>
              </section>
            </div>
          </div>
        ) : step === 'connect' ? (
          <>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>输入网关地址以连接。</p>
            <label
              style={{
                fontSize: 12,
                color: 'var(--fg-muted)',
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
                placeholder={
                  desktopRuntime ? 'https://gateway.example.com' : 'http://localhost:3000'
                }
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
                  color: 'var(--fg-on-accent)',
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
              className="ui-hover-color"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--fg-muted)',
                fontSize: 12,
                cursor: 'pointer',
                alignSelf: 'center',
                marginTop: '0.25rem',
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
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>登录您的账号。</p>
            <OAuthButton
              providerName="GitHub"
              isAuthorized={false}
              onAuthorize={() => logger.info('OAuth: GitHub authorize triggered')}
              onRevoke={() => {}}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0.5rem 0' }}>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-default)' }} />
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>或使用邮箱</span>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-default)' }} />
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
                color: 'var(--fg-muted)',
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
                color: 'var(--fg-muted)',
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
                onClick={() => setStep(desktopRuntime && mode === 'local' ? 'mode' : 'connect')}
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  border: '1px solid var(--border-default)',
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
                  color: 'var(--fg-on-accent)',
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
                color: 'var(--fg-muted)',
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
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>将另一台设备与此工作区配对。</p>
            <PairingPanel
              mode="host"
              host={{
                qrData: pairingQr?.qrData ?? '',
                expiresAt: pairingQr?.expiresAt ?? Date.now(),
                pairedDevices: [],
                onRefreshToken: () => {},
                onDisconnect: () => {},
              }}
              client={{ onScanned: () => {}, onManualCode: () => {} }}
              onModeChange={(_mode: PairingMode) => {}}
            />
            {pairingLoading ? (
              <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>正在生成配对二维码…</p>
            ) : null}
            {pairingError ? (
              <p style={{ fontSize: 12, color: 'var(--danger)' }}>{pairingError}</p>
            ) : null}
            {pairingQr ? (
              <p style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Gateway: {pairingQr.hostUrl}</p>
            ) : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setStep('login')}
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  border: '1px solid var(--border-default)',
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
                  color: 'var(--fg-on-accent)',
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
