import { randomUUID } from 'node:crypto';
import { ChannelFetchTimeoutError, channelFetch } from './channel-http.js';
import { DEFAULT_WEIXIN_BASE_URL } from './weixin-api.js';
import { isRecord, readString } from './inbound-utils.js';

const DEFAULT_ILINK_BOT_TYPE = '3';
const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESH_COUNT = 3;

interface ActiveWeixinLogin {
  readonly sessionKey: string;
  readonly qrcode: string;
  readonly qrCodeUrl: string;
  readonly startedAt: number;
}

export interface WeixinLoginOptions {
  readonly accountId?: string;
  readonly baseUrl?: string;
  readonly routeTag?: string;
  readonly botType?: string;
  readonly force?: boolean;
}

export interface WeixinLoginStartResult {
  readonly sessionKey: string;
  readonly qrCodeUrl?: string;
  readonly message: string;
}

export interface WeixinLoginWaitOptions {
  readonly sessionKey: string;
  readonly baseUrl?: string;
  readonly routeTag?: string;
  readonly botType?: string;
  readonly timeoutMs?: number;
}

export interface WeixinLoginWaitResult {
  readonly connected: boolean;
  readonly message: string;
  readonly token?: string;
  readonly accountId?: string;
  readonly baseUrl?: string;
  readonly userId?: string;
}

const activeLogins = new Map<string, ActiveWeixinLogin>();

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_WEIXIN_BASE_URL).replace(/\/+$/, '');
}

function buildHeaders(routeTag: string | undefined): Record<string, string> {
  return routeTag ? { SKRouteTag: routeTag } : {};
}

function isLoginFresh(login: ActiveWeixinLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function purgeExpiredLogins(): void {
  for (const [key, login] of activeLogins) {
    if (!isLoginFresh(login)) {
      activeLogins.delete(key);
    }
  }
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status} ${rawText || response.statusText}`);
  }
  return rawText ? JSON.parse(rawText) : {};
}

async function fetchQrCode(options: WeixinLoginOptions): Promise<ActiveWeixinLogin> {
  const sessionKey = options.accountId || randomUUID();
  const url =
    `${normalizeBaseUrl(options.baseUrl)}/ilink/bot/get_bot_qrcode` +
    `?bot_type=${encodeURIComponent(options.botType || DEFAULT_ILINK_BOT_TYPE)}`;
  const response = await channelFetch(url, { headers: buildHeaders(options.routeTag) });
  const raw = await readJsonResponse(response, 'Failed to fetch Weixin QR code');
  if (!isRecord(raw)) {
    throw new Error('Weixin QR response is invalid');
  }
  const qrcode = readString(raw, 'qrcode');
  const qrCodeUrl = readString(raw, 'qrcode_img_content');
  if (!qrcode || !qrCodeUrl) {
    throw new Error('Weixin QR response missing qrcode or image content');
  }
  return { sessionKey, qrcode, qrCodeUrl, startedAt: Date.now() };
}

function readStatus(raw: unknown): WeixinLoginWaitResult & { readonly status: string } {
  if (!isRecord(raw)) {
    return { status: 'wait', connected: false, message: 'Waiting for WeChat confirmation.' };
  }
  const status = readString(raw, 'status') || 'wait';
  return {
    status,
    connected: status === 'confirmed',
    message: status === 'confirmed' ? 'Connected to WeChat successfully.' : status,
    token: readString(raw, 'bot_token') || undefined,
    accountId: readString(raw, 'ilink_bot_id') || undefined,
    baseUrl: readString(raw, 'baseurl') || undefined,
    userId: readString(raw, 'ilink_user_id') || undefined,
  };
}

async function pollQrStatus(options: WeixinLoginWaitOptions, qrcode: string) {
  const url =
    `${normalizeBaseUrl(options.baseUrl)}/ilink/bot/get_qrcode_status` +
    `?qrcode=${encodeURIComponent(qrcode)}`;
  try {
    const response = await channelFetch(url, {
      headers: {
        'iLink-App-ClientVersion': '1',
        ...buildHeaders(options.routeTag),
      },
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
    });
    return readStatus(await readJsonResponse(response, 'Failed to poll Weixin QR status'));
  } catch (error) {
    if (
      error instanceof ChannelFetchTimeoutError ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      return { status: 'wait', connected: false, message: 'Waiting for WeChat confirmation.' };
    }
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function startWeixinLoginWithQr(
  options: WeixinLoginOptions,
): Promise<WeixinLoginStartResult> {
  const sessionKey = options.accountId || randomUUID();
  purgeExpiredLogins();
  const existing = activeLogins.get(sessionKey);
  if (!options.force && existing && isLoginFresh(existing) && existing.qrCodeUrl) {
    return {
      sessionKey,
      qrCodeUrl: existing.qrCodeUrl,
      message: 'QR code ready, please scan with WeChat.',
    };
  }

  const login = await fetchQrCode({ ...options, accountId: sessionKey });
  activeLogins.set(sessionKey, login);
  return {
    sessionKey,
    qrCodeUrl: login.qrCodeUrl,
    message: 'Scan the QR code below with WeChat to complete the connection.',
  };
}

export async function waitForWeixinLogin(
  options: WeixinLoginWaitOptions,
): Promise<WeixinLoginWaitResult> {
  let activeLogin = activeLogins.get(options.sessionKey);
  if (!activeLogin) {
    return { connected: false, message: 'No login in progress, please initiate login first.' };
  }
  if (!isLoginFresh(activeLogin)) {
    activeLogins.delete(options.sessionKey);
    return { connected: false, message: 'QR code expired, please regenerate.' };
  }

  const deadline = Date.now() + Math.max(options.timeoutMs ?? 60_000, 1_000);
  let qrRefreshCount = 1;
  while (Date.now() < deadline) {
    const status = await pollQrStatus(options, activeLogin.qrcode);
    if (status.status === 'confirmed') {
      activeLogins.delete(options.sessionKey);
      if (!status.accountId) {
        return { connected: false, message: 'Login failed: server did not return account id.' };
      }
      return status;
    }
    if (status.status === 'expired') {
      qrRefreshCount += 1;
      if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
        activeLogins.delete(options.sessionKey);
        return { connected: false, message: 'QR code expired multiple times, please retry.' };
      }
      activeLogin = await fetchQrCode({
        accountId: options.sessionKey,
        baseUrl: options.baseUrl,
        routeTag: options.routeTag,
        botType: options.botType,
        force: true,
      });
      activeLogins.set(options.sessionKey, activeLogin);
    }
    await delay(1_000);
  }

  activeLogins.delete(options.sessionKey);
  return { connected: false, message: 'Login timeout, please retry.' };
}
