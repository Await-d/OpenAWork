import { z } from 'zod';
import {
  PUBLIC_HTTP_URL_MESSAGE,
  isPublicHttpUrl,
  readPublicUrlError,
} from '../security/public-url-guard.js';

export { PUBLIC_HTTP_URL_MESSAGE, isPublicHttpUrl, readPublicUrlError };

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
