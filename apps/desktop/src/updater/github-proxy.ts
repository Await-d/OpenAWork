/**
 * GitHub proxy detection for China mainland users.
 *
 * Maintains a list of known GitHub proxy/mirror services,
 * probes them concurrently, and returns the fastest reachable one.
 */

export interface GitHubProxy {
  /** Display name */
  name: string;
  /** Prefix URL — append the full GitHub URL after it */
  prefix: string;
}

/**
 * Known GitHub proxy services that support proxying release downloads.
 * Ordered by historical reliability (best first).
 */
export const GITHUB_PROXIES: GitHubProxy[] = [
  { name: 'GHProxy.cn', prefix: 'https://ghp.ci/' },
  { name: 'GitHub Moeyy', prefix: 'https://github.moeyy.xyz/' },
  { name: 'GH-Proxy', prefix: 'https://gh-proxy.com/' },
  { name: 'GHProxy.net', prefix: 'https://ghproxy.net/' },
];

const PROBE_URLS = [
  'https://github.com/Await-d/OpenAWork/releases/latest/download/latest.json',
  'https://github.com/Await-d/OpenAWork/releases/download/desktop-latest-preview/latest.json',
] as const;

/** Timeout for probe requests (ms) */
const PROBE_TIMEOUT_MS = 8000;

/** Session-level cache: once a working proxy is found, reuse it */
let cachedProxy: GitHubProxy | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function probeUrl(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal,
      redirect: 'follow',
    });
    return res.ok || res.status === 302 || res.status === 301;
  } catch {
    return false;
  }
}

async function probeProxy(proxy: GitHubProxy, signal: AbortSignal): Promise<GitHubProxy | null> {
  const probes = PROBE_URLS.map((probeUrlCandidate) =>
    probeUrl(`${proxy.prefix}${probeUrlCandidate}`, signal),
  );
  const results = await Promise.all(probes);
  return results.some(Boolean) ? proxy : null;
}

/**
 * Probe all known proxies concurrently and return the first one that responds.
 * Returns null if none are reachable within the timeout.
 */
export async function detectFastestProxy(): Promise<GitHubProxy | null> {
  // Return cached result if still valid
  if (cachedProxy && Date.now() < cacheExpiry) {
    return cachedProxy;
  }

  const controller = new AbortController();
  const { signal } = controller;

  // Race all proxies — first successful response wins
  const result = await new Promise<GitHubProxy | null>((resolve) => {
    let settled = false;
    let pending = GITHUB_PROXIES.length;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        controller.abort();
        resolve(null);
      }
    }, PROBE_TIMEOUT_MS);

    for (const proxy of GITHUB_PROXIES) {
      void probeProxy(proxy, signal).then((result) => {
        pending -= 1;
        if (result && !settled) {
          settled = true;
          clearTimeout(timer);
          controller.abort();
          resolve(result);
        } else if (pending === 0 && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      });
    }
  });

  if (result) {
    cachedProxy = result;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
  }

  return result;
}

/**
 * Test if direct GitHub access works (without proxy).
 */
export async function canReachGitHubDirectly(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const results = await Promise.all(
      PROBE_URLS.map((probeUrlCandidate) => probeUrl(probeUrlCandidate, controller.signal)),
    );
    clearTimeout(timer);
    return results.some(Boolean);
  } catch {
    return false;
  }
}

/**
 * Prefix a GitHub URL with the given proxy.
 */
export function proxyUrl(githubUrl: string, proxy: GitHubProxy): string {
  return `${proxy.prefix}${githubUrl}`;
}

/** Clear the cached proxy (e.g. after a failure) */
export function clearProxyCache(): void {
  cachedProxy = null;
  cacheExpiry = 0;
}

/** Get the currently cached proxy (for UI display) */
export function getCachedProxy(): GitHubProxy | null {
  if (cachedProxy && Date.now() < cacheExpiry) {
    return cachedProxy;
  }
  return null;
}
