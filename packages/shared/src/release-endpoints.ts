/**
 * Canonical GitHub release endpoints for OpenAWork desktop updater manifests.
 *
 * Keep this module free of runtime I/O so Node gateway, desktop updater, and
 * web clients can share the same URL constants without pulling Tauri deps.
 *
 * .NET gateway mirrors these literals in GetVersionQueryHandler — update both
 * when the release layout changes.
 */

export type UpdateChannel = 'stable' | 'preview';

export const OPENAWORK_GITHUB_REPO = 'Await-d/OpenAWork' as const;

/** Floating preview channel tag used by the release workflow. */
export const DESKTOP_PREVIEW_LATEST_TAG = 'desktop-latest-preview' as const;

export const RELEASE_ENDPOINTS = {
  previewLatestJson: `https://github.com/${OPENAWORK_GITHUB_REPO}/releases/download/${DESKTOP_PREVIEW_LATEST_TAG}/latest.json`,
  previewLatestCnJson: `https://github.com/${OPENAWORK_GITHUB_REPO}/releases/download/${DESKTOP_PREVIEW_LATEST_TAG}/latest-cn.json`,
  stableLatestJson: `https://github.com/${OPENAWORK_GITHUB_REPO}/releases/latest/download/latest.json`,
  stableLatestCnJson: `https://github.com/${OPENAWORK_GITHUB_REPO}/releases/latest/download/latest-cn.json`,
  githubLatestApi: `https://api.github.com/repos/${OPENAWORK_GITHUB_REPO}/releases/latest`,
} as const;

/**
 * Direct (non-proxied) updater JSON endpoints for a channel.
 *
 * Prefer `latest.json` over `latest-cn.json` when the caller will re-proxy URLs
 * itself — latest-cn assets may already be proxy-prefixed by CI.
 */
export function updaterJsonEndpointsForChannel(
  channel: UpdateChannel,
  options?: { includeCn?: boolean },
): string[] {
  const includeCn = options?.includeCn ?? false;
  if (channel === 'preview') {
    return includeCn
      ? [RELEASE_ENDPOINTS.previewLatestJson, RELEASE_ENDPOINTS.previewLatestCnJson]
      : [RELEASE_ENDPOINTS.previewLatestJson];
  }
  return includeCn
    ? [RELEASE_ENDPOINTS.stableLatestJson, RELEASE_ENDPOINTS.stableLatestCnJson]
    : [RELEASE_ENDPOINTS.stableLatestJson];
}

/** Probe-friendly primary latest.json URL for a channel (no cn variant). */
export function primaryLatestJsonForChannel(channel: UpdateChannel): string {
  return channel === 'preview'
    ? RELEASE_ENDPOINTS.previewLatestJson
    : RELEASE_ENDPOINTS.stableLatestJson;
}

export function normalizeUpdateChannel(
  value: string | null | undefined,
  fallback: UpdateChannel = 'preview',
): UpdateChannel {
  if (value === 'stable' || value === 'preview') return value;
  return fallback;
}
