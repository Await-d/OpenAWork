import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';

export const PUBLIC_HTTP_URL_MESSAGE = '只支持公开 HTTP(S) 网页 URL。';
export const GITHUB_REPOSITORY_URL_MESSAGE = '只支持公开 GitHub 仓库 URL。';

export const publicHttpUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .refine(isPublicHttpUrl, PUBLIC_HTTP_URL_MESSAGE);

export const githubRepositoryUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .refine(isPublicGithubRepositoryUrl, GITHUB_REPOSITORY_URL_MESSAGE);

export function isPublicHttpUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url) {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  return !isLocalOrPrivateHost(url.hostname);
}

export function isPublicGithubRepositoryUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url || !isPublicHttpUrl(value)) {
    return false;
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname !== 'github.com' && hostname !== 'www.github.com') {
    return false;
  }

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  return segments.length === 2;
}

export async function readPublicUrlError(value: string, message: string): Promise<string | null> {
  const url = parseUrl(value);
  if (!url || !isPublicHttpUrl(value)) {
    return message;
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || isIP(hostname) !== 0) {
    return null;
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) {
      return message;
    }

    return addresses.some((entry) => isLocalOrPrivateHost(entry.address)) ? message : null;
  } catch {
    return message;
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/u, '')
    .toLowerCase();
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  if (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '::' ||
    normalizedHostname === '::1'
  ) {
    return true;
  }

  const ipVersion = isIP(normalizedHostname);
  if (ipVersion === 4) {
    return isPrivateIpv4(normalizedHostname);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(normalizedHostname);
  }

  return false;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((segment) => Number(segment));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [first, second] = parts;
  if (first === undefined || second === undefined) {
    return false;
  }

  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}
