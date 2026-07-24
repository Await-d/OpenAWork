/**
 * Resolve the latest published app version from GitHub Releases.
 *
 * Historical bug: `/settings/version` queried
 * `https://registry.npmjs.org/@openAwork/agent-gateway/latest`, but the
 * package is `private: true` and has never been published. That made the
 * About / Settings "检查更新" button a no-op for every release build.
 *
 * The desktop installer already publishes Tauri updater manifests; this
 * helper reads the same channel endpoints from `@openAwork/shared`.
 */

import {
  normalizeUpdateChannel,
  RELEASE_ENDPOINTS,
  GITHUB_PROXIES,
  type UpdateChannel,
} from '@openAwork/shared';

export type { UpdateChannel };

export interface ReleaseVersionCheckResult {
  latestVersion: string | null;
  updateAvailable: boolean;
  checkError: string | null;
  /** Which endpoint produced the result (channel json or github-api). */
  source: UpdateChannel | 'github-api' | null;
  /** Requested / resolved channel used for this check. */
  channel: UpdateChannel;
}

export interface ReleaseVersionCheckOptions {
  currentVersion: string;
  /**
   * Desktop update channel. Defaults to `preview` (current active published
   * channel). When set, only that channel's latest.json is tried before the
   * GitHub API fallback — matching the channel-aware Tauri updater.
   */
  channel?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoints?: {
    previewLatestJson?: string;
    stableLatestJson?: string;
    githubLatestApi?: string;
  };
}

export function normalizeReleaseVersion(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  // Strip optional +build metadata (assembly informational versions) before compare/display.
  let trimmed = raw.trim();
  const plusIndex = trimmed.indexOf('+');
  if (plusIndex >= 0) {
    trimmed = trimmed.slice(0, plusIndex);
  }
  trimmed = trimmed.replace(/^v/i, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => {
      const match = part.match(/^\d+/);
      return match ? Number.parseInt(match[0], 10) : 0;
    });
}

/** Return true when `candidate` is strictly newer than `current`. */
export function isNewerReleaseVersion(candidate: string, current: string): boolean {
  const left = parseVersionParts(candidate);
  const right = parseVersionParts(current);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  accept = 'application/json',
): Promise<unknown> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'OpenAWork-gateway-version-check',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function versionFromUpdaterJson(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const version = (payload as { version?: unknown }).version;
  return typeof version === 'string' ? normalizeReleaseVersion(version) : null;
}

function versionFromGithubReleaseApi(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { tag_name?: unknown; name?: unknown };
  return (
    normalizeReleaseVersion(typeof record.tag_name === 'string' ? record.tag_name : null) ??
    normalizeReleaseVersion(typeof record.name === 'string' ? record.name : null)
  );
}

/**
 * Check GitHub release manifests for a version newer than `currentVersion`.
 *
 * Channel-aware: tries the requested channel's latest.json first, then GitHub
 * Releases API. This matches the desktop updater's channel selection so the
 * About status card and install path stay consistent.
 */
export async function checkLatestReleaseVersion(
  options: ReleaseVersionCheckOptions,
): Promise<ReleaseVersionCheckResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const channel = normalizeUpdateChannel(options.channel, 'preview');
  const endpoints = {
    previewLatestJson: options.endpoints?.previewLatestJson ?? RELEASE_ENDPOINTS.previewLatestJson,
    stableLatestJson: options.endpoints?.stableLatestJson ?? RELEASE_ENDPOINTS.stableLatestJson,
    githubLatestApi: options.endpoints?.githubLatestApi ?? RELEASE_ENDPOINTS.githubLatestApi,
  };

  const currentVersion = normalizeReleaseVersion(options.currentVersion) ?? options.currentVersion;
  const channelLatestJson =
    channel === 'preview' ? endpoints.previewLatestJson : endpoints.stableLatestJson;

  const candidates: Array<{
    source: ReleaseVersionCheckResult['source'];
    url: string;
    parse: (p: unknown) => string | null;
    accept?: string;
  }> = [
    {
      source: channel,
      url: channelLatestJson,
      parse: versionFromUpdaterJson,
    },
    {
      source: 'github-api',
      url: endpoints.githubLatestApi,
      parse: versionFromGithubReleaseApi,
      accept: 'application/vnd.github+json',
    },
  ];

  // When direct GitHub access fails (China mainland / firewall), fall back to
  // proxy/mirror services that cache GitHub release assets.
  for (const proxy of GITHUB_PROXIES) {
    candidates.push(
      {
        source: `${channel}-proxy` as ReleaseVersionCheckResult['source'],
        url: `${proxy.prefix}${channelLatestJson}`,
        parse: versionFromUpdaterJson,
      },
      {
        source: 'github-api-proxy' as ReleaseVersionCheckResult['source'],
        url: `${proxy.prefix}${endpoints.githubLatestApi}`,
        parse: versionFromGithubReleaseApi,
        accept: 'application/vnd.github+json',
      },
    );
  }

  let sawNetworkAttempt = false;
  for (const candidate of candidates) {
    sawNetworkAttempt = true;
    const payload = await fetchJson(
      candidate.url,
      fetchImpl,
      timeoutMs,
      candidate.accept ?? 'application/json',
    );
    if (payload == null) continue;
    const latestVersion = candidate.parse(payload);
    if (!latestVersion) continue;
    return {
      latestVersion,
      updateAvailable: isNewerReleaseVersion(latestVersion, currentVersion),
      checkError: null,
      source: candidate.source,
      channel,
    };
  }

  return {
    latestVersion: null,
    updateAvailable: false,
    checkError: sawNetworkAttempt
      ? 'Unable to reach GitHub releases or mirrors'
      : 'Unable to check for updates',
    source: null,
    channel,
  };
}
