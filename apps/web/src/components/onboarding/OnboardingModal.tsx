import { useActionState, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/auth/auth.js';
import { getPairingQr, login, type PairingQrResponse } from '@openAwork/web-client';
import { PairingPanel } from '@openAwork/shared-ui';
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

/* ─── Shared header & icons ─── */

function OnboardingHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="onboarding-brand">
      <div className="onboarding-brand-icon">
        <AppIcon size={22} />
      </div>
      <div>
        <div className="onboarding-brand-title">OpenAWork</div>
        {subtitle && <div className="onboarding-brand-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="关闭引导" className="onboarding-close">
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

function ServerIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="2.5" width="13" height="5" rx="1.5" />
      <rect x="2.5" y="10.5" width="13" height="5" rx="1.5" />
      <circle cx="5" cy="5" r="0.5" fill="currentColor" />
      <circle cx="5" cy="13" r="0.5" fill="currentColor" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 13.5h8.5a3 3 0 0 0 0.4-5.97A4.5 4.5 0 0 0 4.7 8 3.25 3.25 0 0 0 5 13.5z" />
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

/* ─── Desktop Onboarding ─── */

/**
 * 「启动本地网关」整条流程的**外层看门狗**上限。
 *
 * 这条流程内部的三段等待各自都有硬上界（原生侧 `STARTUP_HEALTH_WAIT_TIMEOUT`
 * 15s、`waitForGatewayHealth` 15s、`authenticate_desktop_gateway` 30s），但那只是
 * 「超时后会 reject」。如果 Tauri IPC 的响应丢失（Rust task 被 drop / panic 后
 * 没有回包），`await` 会**永远挂起**，按钮就永久停在「正在启动并进入…」。
 *
 * 与 `App.tsx::useDesktopGatewayBootstrap` 的注释保持同一意图：任何异常都必须
 * 落到可展示的失败态，不允许遮罩/按钮永久停在 starting。此处 45s 明显大于内部
 * 三段之和，留出冷启动余量的同时又能兜住 IPC 悬挂。
 */
const LOCAL_GATEWAY_START_WATCHDOG_MS = 45_000;

/**
 * 给一个可能永不 settle 的 Promise 套上固定超时。
 *
 * 超时后抛出 `message`，由调用方统一落失败态；原 Promise 后续若再 settle，
 * 只会走已注册的成功分支（resolve 无副作用），不会覆盖超时结果。
 */
function withStartupWatchdog<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    work.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (workError: unknown) => {
        globalThis.clearTimeout(timer);
        reject(workError instanceof Error ? workError : new Error(String(workError)));
      },
    );
  });
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

  /**
   * 启动尝试的序号。取消 / 重试时自增，让仍在飞行的旧异步流程在回调时
   * 发现自己已过期并放弃写状态——否则「取消」之后，旧 promise 迟到的
   * catch/finally 会把 UI 又改回 starting 或 fail。
   */
  const localAttemptRef = useRef(0);

  async function chooseLocalGateway() {
    const port = parseGatewayPort(portInput, DEFAULT_GATEWAY_PORT);
    const url = localGatewayUrl(port);

    localAttemptRef.current += 1;
    const attempt = localAttemptRef.current;

    setLocalStatus('starting');
    setRemoteStatus('idle');
    setError(null);
    setPortInput(String(port));
    setUrlInput(url);

    // 与 `App.tsx::useDesktopGatewayBootstrap` 保持同一份预算：start_gateway 自身
    // 最多耗时 15s（原生侧 STARTUP_HEALTH_WAIT_TIMEOUT），必须计入等待预算，
    // 否则两层各自 15s 计时会让失败场景空等 2 倍时间才报错。
    const startedAt = Date.now();

    try {
      await withStartupWatchdog(
        (async () => {
          await startDesktopGateway(port);
          if (!(await waitForGatewayHealth(url, { startedAt }))) {
            throw new Error(
              '本地网关健康检查未通过。请确认该端口未被其他程序占用，或改用其它端口后重试。',
            );
          }

          await completeLocalDesktopOnboarding(url, port);
        })(),
        LOCAL_GATEWAY_START_WATCHDOG_MS,
        '启动本地网关超时（45 秒）。内置网关可能未能启动，请重试；若反复失败请改用「连接远程网关」。',
      );

      if (localAttemptRef.current !== attempt) {
        return;
      }
      setLocalStatus('ok');
    } catch (eventualError: unknown) {
      if (localAttemptRef.current !== attempt) {
        return;
      }
      setLocalStatus('fail');
      setError(eventualError instanceof Error ? eventualError.message : '无法启动本地网关。');
    }
  }

  /**
   * 取消正在进行的本地网关启动。
   *
   * 自增 attempt 让旧流程自行放弃写状态（无需卸载组件），再停掉可能已经
   * 拉起但迟迟不健康的 sidecar——否则用户取消后端口仍被占着，重试会撞上
   * 「端口已被占用」。
   */
  function cancelLocalGateway() {
    localAttemptRef.current += 1;
    setLocalStatus('idle');
    setError(null);

    void stopDesktopGateway().catch((eventualError: unknown) => {
      logger.warn('Failed to stop local desktop gateway after cancel', eventualError);
    });
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
      setError('请先填写远程网关地址。');
      return;
    }
    if (!remoteEmail || !remotePassword) {
      setRemoteStatus('fail');
      setError('请填写远程网关管理员邮箱和密码。');
      return;
    }

    setRemoteStatus('testing');
    try {
      if (!(await waitForGatewayHealth(url))) {
        throw new Error('远程网关健康检查失败，请确认地址可访问。');
      }

      const tokenPair = await login(url, remoteEmail, remotePassword);
      setRemoteStatus('ok');
      completeDesktopOnboarding(url, 'remote', port, tokenPair, remoteEmail);
    } catch (eventualError: unknown) {
      setRemoteStatus('fail');
      setError(eventualError instanceof Error ? eventualError.message : '无法连接远程网关。');
    }
  }

  return (
    <div className="onboarding-overlay">
      <div className={`onboarding-modal${step === 'mode' ? ' onboarding-modal--wide' : ''}`}>
        <OnboardingHeader subtitle="Desktop Setup" />

        <p className="onboarding-tagline">
          桌面端会使用默认本地身份进入工作台。首次启动只需要选择网关来源，后续可在设置中切换。
        </p>

        {step === 'mode' ? (
          <div className="onboarding-grid">
            <section className="onboarding-mode-card onboarding-mode-card--primary">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="onboarding-mode-icon">
                  <ServerIcon />
                </div>
                <div className="onboarding-mode-title">使用本地网关</div>
              </div>
              <p className="onboarding-mode-desc">
                适合单机使用。桌面端会启动内置 Gateway，并自动进入工作台。
              </p>
              <div className="onboarding-form-field">
                <label className="onboarding-form-label" htmlFor="onboarding-local-port">
                  本地端口
                </label>
                <input
                  id="onboarding-local-port"
                  className="onboarding-input"
                  type="number"
                  min={1}
                  max={65535}
                  value={portInput}
                  onChange={(event) => setPortInput(event.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button
                  type="button"
                  onClick={() => void chooseLocalGateway()}
                  disabled={localStatus === 'starting' || localStatus === 'ok'}
                  className="onboarding-mode-action"
                  style={{ flex: 1, width: 'auto', marginTop: 0 }}
                >
                  {localStatus === 'starting'
                    ? '正在启动并进入…'
                    : localStatus === 'ok'
                      ? '本地网关已就绪'
                      : localStatus === 'fail'
                        ? '重试启动本地网关'
                        : '使用本地网关'}
                </button>
                {localStatus === 'starting' ? (
                  <button
                    type="button"
                    onClick={cancelLocalGateway}
                    className="onboarding-mode-action onboarding-mode-action--secondary"
                    style={{ flex: '0 0 auto', width: 'auto', marginTop: 0 }}
                  >
                    取消
                  </button>
                ) : null}
              </div>
            </section>

            <section className="onboarding-mode-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="onboarding-mode-icon">
                  <CloudIcon />
                </div>
                <div className="onboarding-mode-title">连接远程网关</div>
              </div>
              <p className="onboarding-mode-desc">
                适合连接团队服务器、NAS、云端部署或已经运行的 OpenAWork Gateway。
              </p>
              <button
                type="button"
                onClick={chooseRemoteGateway}
                className="onboarding-mode-action onboarding-mode-action--secondary"
              >
                输入远程网关地址
              </button>
            </section>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="onboarding-form-field">
              <label className="onboarding-form-label" htmlFor="onboarding-remote-url">
                远程网关地址
              </label>
              <input
                id="onboarding-remote-url"
                className="onboarding-input"
                type="url"
                value={urlInput}
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  setRemoteStatus('idle');
                }}
                placeholder="https://gateway.example.com"
              />
            </div>
            <div className="onboarding-form-field">
              <label className="onboarding-form-label" htmlFor="onboarding-remote-email">
                管理员邮箱
              </label>
              <input
                id="onboarding-remote-email"
                className="onboarding-input"
                type="email"
                value={remoteEmail}
                onChange={(event) => setRemoteEmail(event.target.value)}
                autoComplete="username"
                placeholder={DESKTOP_DEFAULT_EMAIL}
              />
            </div>
            <div className="onboarding-form-field">
              <label className="onboarding-form-label" htmlFor="onboarding-remote-pwd">
                管理员密码
              </label>
              <input
                id="onboarding-remote-pwd"
                className="onboarding-input"
                type="password"
                value={remotePassword}
                onChange={(event) => setRemotePassword(event.target.value)}
                autoComplete="current-password"
                placeholder="远程 Gateway 管理员密码"
              />
            </div>

            <div className="onboarding-actions">
              <button
                type="button"
                onClick={() => setStep('mode')}
                className="onboarding-action-btn onboarding-action-btn--ghost"
              >
                返回
              </button>
              <button
                type="button"
                onClick={() => void connectRemoteGateway()}
                disabled={remoteStatus === 'testing'}
                className="onboarding-action-btn onboarding-action-btn--primary"
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

        {error && (
          <div className="onboarding-error" style={{ display: 'flex', gap: 8 }}>
            <ErrorIcon />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Browser Onboarding ─── */

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
    setTestStatus('idle');

    try {
      await startDesktopGateway(port);
      if (!(await waitForGatewayHealth(url))) {
        throw new Error('本地服务端已启动，但健康检查暂未通过。');
      }

      setLocalStatus('ok');
      setStep('login');
    } catch (error: unknown) {
      setLocalStatus('fail');
      setLocalError(error instanceof Error ? error.message : '无法启动本地服务端。');
    }
  }

  function chooseRemoteGateway() {
    setMode('remote');
    writeDesktopGatewayMode('remote');
    setWebAccess(false, parseGatewayPort(portInput, webPort || DEFAULT_GATEWAY_PORT));
    setLocalStatus('idle');
    setLocalError(null);
    setTestStatus('idle');
    setStep('connect');

    void stopDesktopGateway().catch((error: unknown) => {
      logger.warn('Failed to stop local desktop gateway before remote setup', error);
    });
  }

  const showCloseButton = !(desktopRuntime && step === 'mode');

  return (
    <div className="onboarding-overlay">
      <div className={`onboarding-modal${step === 'mode' ? ' onboarding-modal--wide' : ''}`}>
        {showCloseButton && <CloseButton onClick={onComplete} />}

        <OnboardingHeader
          subtitle={
            step === 'mode'
              ? '初始设置'
              : step === 'connect'
                ? '连接 Gateway'
                : step === 'login'
                  ? '登录账号'
                  : '设备配对'
          }
        />

        {step === 'mode' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p className="onboarding-tagline">首次启动桌面端时，请选择服务端连接方式。</p>
            <div className="onboarding-grid">
              <section className="onboarding-mode-card onboarding-mode-card--primary">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="onboarding-mode-icon">
                    <ServerIcon />
                  </div>
                  <div className="onboarding-mode-title">启动本地服务端</div>
                </div>
                <p className="onboarding-mode-desc">
                  适合单机使用。桌面端会启动内置 Gateway，并自动连接到本机地址。
                </p>
                <div className="onboarding-form-field">
                  <label className="onboarding-form-label" htmlFor="browser-onboarding-port">
                    本地端口
                  </label>
                  <input
                    id="browser-onboarding-port"
                    className="onboarding-input"
                    type="number"
                    min={1}
                    max={65535}
                    value={portInput}
                    onChange={(e) => setPortInput(e.target.value)}
                  />
                </div>
                {localError && (
                  <div className="onboarding-error" style={{ display: 'flex', gap: 8 }}>
                    <ErrorIcon />
                    <span>{localError}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void chooseLocalGateway()}
                  disabled={localStatus === 'starting'}
                  className="onboarding-mode-action"
                >
                  {localStatus === 'starting'
                    ? '正在启动本地服务端…'
                    : localStatus === 'ok'
                      ? '本地服务端已启动'
                      : '使用本地服务端'}
                </button>
              </section>

              <section className="onboarding-mode-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="onboarding-mode-icon">
                    <CloudIcon />
                  </div>
                  <div className="onboarding-mode-title">连接远程服务端</div>
                </div>
                <p className="onboarding-mode-desc">
                  适合连接团队服务器、NAS、云端部署或已经运行的 OpenAWork Gateway。
                </p>
                <button
                  type="button"
                  onClick={chooseRemoteGateway}
                  className="onboarding-mode-action onboarding-mode-action--secondary"
                >
                  输入远程服务端地址
                </button>
              </section>
            </div>
          </div>
        ) : step === 'connect' ? (
          <>
            <p className="onboarding-tagline">输入网关地址以连接。</p>
            <div className="onboarding-form-field">
              <label className="onboarding-form-label" htmlFor="browser-onboarding-url">
                网关地址
              </label>
              <input
                id="browser-onboarding-url"
                className="onboarding-input"
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  setTestStatus('idle');
                }}
                placeholder={
                  desktopRuntime ? 'https://gateway.example.com' : 'http://localhost:3000'
                }
              />
            </div>
            <div className="onboarding-actions">
              <button
                type="button"
                onClick={() => void testConnection()}
                className="onboarding-action-btn onboarding-action-btn--accent-ghost"
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
                className="onboarding-action-btn onboarding-action-btn--primary"
              >
                继续
              </button>
            </div>
            <button type="button" onClick={onComplete} className="onboarding-link-btn">
              跳过引导，直接登录
            </button>
          </>
        ) : step === 'login' ? (
          <BrowserOnboardingLoginForm
            urlInput={urlInput}
            onAuthenticated={(data, email) => {
              setAuth(data.accessToken, email, data.refreshToken, data.expiresIn);
              localStorage.setItem('onboarded', '1');
              if (desktopRuntime && mode) {
                writeDesktopGatewayMode(mode);
              }
              onComplete();
            }}
            onBack={() => setStep(desktopRuntime && mode === 'local' ? 'mode' : 'connect')}
            onPair={() => setStep('pairing')}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p className="onboarding-tagline">将另一台设备与此工作区配对。</p>
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
            {pairingLoading && (
              <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: 0 }}>
                正在生成配对二维码…
              </p>
            )}
            {pairingError && (
              <div className="onboarding-error" style={{ display: 'flex', gap: 8 }}>
                <ErrorIcon />
                <span>{pairingError}</span>
              </div>
            )}
            {pairingQr && (
              <p style={{ fontSize: 11, color: 'var(--fg-muted)', margin: 0 }}>
                Gateway: {pairingQr.hostUrl}
              </p>
            )}
            <div className="onboarding-actions">
              <button
                type="button"
                onClick={() => setStep('login')}
                className="onboarding-action-btn onboarding-action-btn--ghost"
              >
                返回
              </button>
              <button
                type="button"
                onClick={onComplete}
                className="onboarding-action-btn onboarding-action-btn--primary"
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

/* ─── Browser Onboarding · Login Form 子组件 ─── */

interface BrowserLoginAuthData {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: string;
}

interface BrowserOnboardingLoginFormProps {
  urlInput: string;
  onAuthenticated: (data: BrowserLoginAuthData, email: string) => void;
  onBack: () => void;
  onPair: () => void;
}

/**
 * 把 useActionState 局部化到子组件——这样 BrowserOnboardingModal 切到非 login
 * step 时子组件 unmount，actionState 自动重置，避免用户再切回来仍看到旧的 loginError。
 */
function BrowserOnboardingLoginForm({
  urlInput,
  onAuthenticated,
  onBack,
  onPair,
}: BrowserOnboardingLoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // React 19 Actions：表单提交由 useActionState 管理 pending / error。
  const [loginError, loginAction, logging] = useActionState<string | null>(async () => {
    const url = normalizeGatewayUrl(urlInput);
    try {
      const data = await login(url, email, password);
      onAuthenticated(data, email);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : '网络错误 — Gateway 是否正在运行？';
    }
  }, null);

  return (
    <form action={loginAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p className="onboarding-tagline">登录您的账号。</p>
      {loginError && (
        <div className="onboarding-error" style={{ display: 'flex', gap: 8 }}>
          <ErrorIcon />
          <span>{loginError}</span>
        </div>
      )}
      <div className="onboarding-form-field">
        <label className="onboarding-form-label" htmlFor="browser-onboarding-email">
          邮箱
        </label>
        <input
          id="browser-onboarding-email"
          className="onboarding-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="your@email.com"
        />
      </div>
      <div className="onboarding-form-field">
        <label className="onboarding-form-label" htmlFor="browser-onboarding-password">
          密码
        </label>
        <input
          id="browser-onboarding-password"
          className="onboarding-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          placeholder="••••••••"
        />
      </div>
      <div className="onboarding-actions">
        <button
          type="button"
          onClick={onBack}
          className="onboarding-action-btn onboarding-action-btn--ghost"
        >
          返回
        </button>
        <button
          type="submit"
          disabled={logging}
          className="onboarding-action-btn onboarding-action-btn--primary"
        >
          {logging ? '登录中…' : '登录'}
        </button>
      </div>
      <button
        type="button"
        onClick={onPair}
        className="onboarding-link-btn onboarding-link-btn--underline"
      >
        设备配对（可选）
      </button>
    </form>
  );
}
