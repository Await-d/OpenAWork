import React, { useState } from 'react';
import { getPairingQr, login as apiLogin, type PairingQrResponse } from '@openAwork/web-client';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../../../web/src/stores/auth.js';
import {
  type DesktopGatewayMode,
  authenticateDesktopGateway,
  DEFAULT_GATEWAY_PORT,
  DESKTOP_DEFAULT_EMAIL,
  isGatewayHealthy,
  localGatewayUrl,
  normalizeGatewayUrl,
  parseGatewayPort,
  readDesktopGatewayMode,
  readGatewayPortFromUrl,
  waitForGatewayHealth,
  writeDesktopGatewayMode,
} from '../utils/gateway-mode.js';
import { startDesktopGateway, stopDesktopGateway } from '../utils/tauri-gateway.js';

const inputStyle: React.CSSProperties = {
  background: 'hsl(var(--muted) / 0.6)',
  border: '1px solid hsl(var(--border-default))',
  borderRadius: 10,
  padding: '10px 12px',
  color: 'hsl(var(--foreground))',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'hsl(var(--muted-foreground))',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const primaryButtonStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)',
  color: 'hsl(var(--primary-foreground))',
  border: '1px solid hsl(var(--primary) / 0.35)',
  borderRadius: 10,
  padding: '0.75rem 0.9rem',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'transform 160ms ease, opacity 160ms ease, border-color 160ms ease',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: 'hsl(var(--muted) / 0.35)',
  color: 'hsl(var(--foreground) / 0.82)',
  border: '1px solid hsl(var(--border-default))',
  borderRadius: 10,
  padding: '0.75rem 0.9rem',
  fontSize: 13,
  fontWeight: 650,
  cursor: 'pointer',
  transition: 'background 160ms ease, color 160ms ease, border-color 160ms ease',
};

const quietButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'hsl(var(--muted-foreground))',
  border: '1px solid hsl(var(--border-default))',
  borderRadius: 10,
  padding: '0.7rem 0.9rem',
  fontSize: 13,
  cursor: 'pointer',
};

type Step = 'mode' | 'connect' | 'login' | 'pairing';
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';
type LocalStatus = 'idle' | 'starting' | 'ok' | 'fail';

interface Props {
  onComplete?: () => void;
}

function modeTitle(mode: DesktopGatewayMode | null): string {
  return mode === 'local' ? '本地服务端' : '远程服务端';
}

export default function OnboardingWizard({ onComplete }: Props) {
  const navigate = useNavigate();
  const { accessToken, gatewayUrl, setGatewayUrl, setAuth, setWebAccess, webPort } = useAuthStore();
  const initialPort = readGatewayPortFromUrl(gatewayUrl, webPort || DEFAULT_GATEWAY_PORT);
  const [mode, setMode] = useState<DesktopGatewayMode | null>(() => readDesktopGatewayMode());
  const [urlInput, setUrlInput] = useState(gatewayUrl);
  const [portInput, setPortInput] = useState(String(initialPort));
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [localStatus, setLocalStatus] = useState<LocalStatus>('idle');
  const [localError, setLocalError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('mode');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [pairingQr, setPairingQr] = useState<PairingQrResponse | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  async function completeDesktopOnboarding(
    url: string,
    nextMode: DesktopGatewayMode,
    port: number,
    tokenPair: { accessToken: string; refreshToken?: string; expiresIn?: string },
    authEmail: string,
  ) {
    setAuth(tokenPair.accessToken, authEmail, tokenPair.refreshToken, tokenPair.expiresIn);
    setGatewayUrl(url);
    setWebAccess(nextMode === 'local', port);
    localStorage.setItem('onboarded', '1');
    writeDesktopGatewayMode(nextMode);

    if (onComplete) {
      onComplete();
    } else {
      void navigate('/sessions', { replace: true });
    }
  }

  async function completeLocalDesktopOnboarding(url: string, port: number) {
    const tokenPair = await authenticateDesktopGateway(url);
    await completeDesktopOnboarding(url, 'local', port, tokenPair, DESKTOP_DEFAULT_EMAIL);
  }

  async function chooseLocalGateway() {
    const port = parseGatewayPort(portInput, DEFAULT_GATEWAY_PORT);
    const url = localGatewayUrl(port);

    setMode('local');
    setPortInput(String(port));
    setUrlInput(url);
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
      await completeLocalDesktopOnboarding(url, port);
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
      console.warn('Failed to stop local desktop gateway before remote setup', error);
    });
  }

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

  async function saveAndContinue() {
    const url = normalizeGatewayUrl(urlInput);
    const port = parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT);
    setGatewayUrl(url);
    setMode('remote');
    writeDesktopGatewayMode('remote');
    setWebAccess(false, port);
    setLoginError(null);

    if (!email || !password) {
      setLoginError('请填写远程服务端管理员邮箱和密码');
      return;
    }

    try {
      const tokenPair = await apiLogin(url, email, password);
      await completeDesktopOnboarding(url, 'remote', port, tokenPair, email);
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : '无法连接远程网关');
    }
  }

  async function loadPairingQr() {
    const url = normalizeGatewayUrl(urlInput);
    setPairingLoading(true);
    setPairingError(null);
    try {
      setPairingQr(await getPairingQr(url, accessToken ?? undefined));
      setStep('pairing');
    } catch (error: unknown) {
      setPairingError(error instanceof Error ? error.message : '无法加载配对二维码');
    } finally {
      setPairingLoading(false);
    }
  }

  async function handleLogin(e: React.SyntheticEvent) {
    e.preventDefault();
    setLoginError(null);
    setLogging(true);
    const url = normalizeGatewayUrl(urlInput);
    try {
      const data = await apiLogin(url, email, password);
      setAuth(data.accessToken, email, data.refreshToken, data.expiresIn);
      localStorage.setItem('onboarded', '1');
      if (mode) {
        writeDesktopGatewayMode(mode);
      }
      if (onComplete) {
        onComplete();
      } else {
        void navigate('/sessions', { replace: true });
      }
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : '网络错误 — Gateway 是否正在运行？');
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
        minHeight: '100dvh',
        padding: 24,
        background:
          'radial-gradient(circle at top left, hsl(var(--accent) / 0.22), transparent 34%), hsl(var(--background))',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, hsl(var(--card) / 0.98), hsl(var(--card) / 0.9))',
          border: '1px solid hsl(var(--border-default))',
          borderRadius: 22,
          padding: step === 'mode' ? '2rem' : '1.75rem',
          width:
            step === 'mode' ? 'min(760px, calc(100vw - 48px))' : 'min(440px, calc(100vw - 48px))',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          boxShadow: '0 24px 80px hsl(220 40% 2% / 0.42)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span
            style={{
              color: 'hsl(var(--accent))',
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            OpenAWork Desktop
          </span>
          <h1 style={{ fontSize: step === 'mode' ? 28 : 22, fontWeight: 800, margin: 0 }}>
            {step === 'mode' ? '选择首次启动方式' : modeTitle(mode)}
          </h1>
          <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
            {step === 'mode'
              ? '你可以直接启动本机内置服务端，也可以连接团队或云端已部署的远程服务端。'
              : `当前连接地址：${normalizeGatewayUrl(urlInput) || '尚未设置'}`}
          </p>
        </div>

        {step === 'mode' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            <section
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                minHeight: 260,
                padding: 18,
                border: '1px solid hsl(var(--accent) / 0.32)',
                borderRadius: 18,
                background:
                  'linear-gradient(135deg, hsl(var(--accent) / 0.14), hsl(var(--muted) / 0.2))',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <strong style={{ fontSize: 17 }}>启动本地服务端</strong>
                <span
                  style={{ color: 'hsl(var(--muted-foreground))', fontSize: 13, lineHeight: 1.55 }}
                >
                  适合单机使用。桌面端会启动内置 Gateway，并把连接地址设为本机回环地址。
                </span>
              </div>
              <label style={labelStyle}>
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
                <p style={{ color: 'hsl(var(--destructive))', fontSize: 12, margin: 0 }}>
                  {localError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void chooseLocalGateway()}
                disabled={localStatus === 'starting'}
                style={{
                  ...primaryButtonStyle,
                  marginTop: 'auto',
                  opacity: localStatus === 'starting' ? 0.72 : 1,
                  cursor: localStatus === 'starting' ? 'not-allowed' : 'pointer',
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
                gap: 16,
                minHeight: 260,
                padding: 18,
                border: '1px solid hsl(var(--border-default))',
                borderRadius: 18,
                background: 'hsl(var(--muted) / 0.18)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <strong style={{ fontSize: 17 }}>连接远程服务端</strong>
                <span
                  style={{ color: 'hsl(var(--muted-foreground))', fontSize: 13, lineHeight: 1.55 }}
                >
                  适合连接服务器、NAS、团队共享环境或已经运行的 OpenAWork Gateway。
                </span>
              </div>
              <button
                type="button"
                onClick={chooseRemoteGateway}
                style={{ ...secondaryButtonStyle, marginTop: 'auto' }}
              >
                输入远程服务端地址
              </button>
            </section>
          </div>
        ) : step === 'connect' ? (
          <>
            <label style={labelStyle}>
              远程服务端地址
              <input
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  setTestStatus('idle');
                }}
                placeholder="https://gateway.example.com"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              管理员邮箱
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder={DESKTOP_DEFAULT_EMAIL}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              管理员密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="远程 Gateway 管理员密码"
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setStep('mode')}
                style={{ ...quietButtonStyle, flex: 1 }}
              >
                返回
              </button>
              <button
                type="button"
                onClick={() => void testConnection()}
                style={{ ...secondaryButtonStyle, flex: 1 }}
              >
                {testStatus === 'testing'
                  ? '测试中…'
                  : testStatus === 'ok'
                    ? '已连接'
                    : testStatus === 'fail'
                      ? '失败，重试'
                      : '测试连接'}
              </button>
              <button
                type="button"
                onClick={() => void saveAndContinue()}
                disabled={testStatus !== 'ok'}
                style={{
                  ...primaryButtonStyle,
                  flex: 1,
                  cursor: testStatus !== 'ok' ? 'not-allowed' : 'pointer',
                  opacity: testStatus !== 'ok' ? 0.5 : 1,
                }}
              >
                进入工作台
              </button>
            </div>
            {loginError ? (
              <p style={{ color: 'hsl(var(--destructive))', fontSize: 12, margin: 0 }}>
                {loginError}
              </p>
            ) : null}
          </>
        ) : step === 'login' ? (
          <form
            onSubmit={(e) => {
              void handleLogin(e);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
              登录您的账号以完成桌面端初始化。
            </p>
            {loginError ? (
              <div
                style={{
                  background: 'hsl(var(--destructive) / 0.1)',
                  border: '1px solid hsl(var(--destructive) / 0.3)',
                  borderRadius: 8,
                  padding: '0.65rem 0.75rem',
                  color: 'hsl(var(--destructive))',
                  fontSize: 13,
                }}
              >
                {loginError}
              </div>
            ) : null}
            <label style={labelStyle}>
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
            <label style={labelStyle}>
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
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setStep(mode === 'remote' ? 'connect' : 'mode')}
                style={{ ...quietButtonStyle, flex: 1 }}
              >
                返回
              </button>
              <button
                type="submit"
                disabled={logging}
                style={{
                  ...primaryButtonStyle,
                  flex: 1,
                  cursor: logging ? 'not-allowed' : 'pointer',
                  opacity: logging ? 0.7 : 1,
                }}
              >
                {logging ? '登录中…' : '登录并进入'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void loadPairingQr()}
              disabled={pairingLoading}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'hsl(var(--muted-foreground))',
                cursor: pairingLoading ? 'not-allowed' : 'pointer',
                fontSize: 13,
                textDecoration: 'underline',
              }}
            >
              {pairingLoading ? '生成二维码中…' : '显示手机扫码登录二维码'}
            </button>
            {pairingError ? (
              <p style={{ color: 'hsl(var(--destructive))', fontSize: 12, margin: 0 }}>
                {pairingError}
              </p>
            ) : null}
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
              使用手机 OpenAWork 扫描二维码即可登录此 Gateway。
            </p>
            {pairingQr ? (
              <img
                src={pairingQr.dataUrl}
                alt="手机扫码登录二维码"
                style={{ alignSelf: 'center', width: 220, height: 220, borderRadius: 12 }}
              />
            ) : null}
            {pairingQr ? (
              <code
                style={{
                  color: 'hsl(var(--muted-foreground))',
                  fontSize: 11,
                  wordBreak: 'break-all',
                }}
              >
                {pairingQr.hostUrl}
              </code>
            ) : null}
            <button type="button" onClick={() => setStep('login')} style={quietButtonStyle}>
              返回账号登录
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
