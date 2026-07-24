import { describe, expect, it, vi } from 'vitest';
import {
  checkLatestReleaseVersion,
  isNewerReleaseVersion,
  normalizeReleaseVersion,
} from '../../app/release-version-check.js';

describe('normalizeReleaseVersion', () => {
  it('strips leading v and trims', () => {
    expect(normalizeReleaseVersion(' v0.8.2 ')).toBe('0.8.2');
    expect(normalizeReleaseVersion('0.8.2')).toBe('0.8.2');
  });

  it('strips +build metadata', () => {
    expect(normalizeReleaseVersion('0.8.3+abc123')).toBe('0.8.3');
    expect(normalizeReleaseVersion('v0.8.3+git.sha')).toBe('0.8.3');
  });

  it('returns null for empty input', () => {
    expect(normalizeReleaseVersion('')).toBeNull();
    expect(normalizeReleaseVersion(null)).toBeNull();
  });
});

describe('isNewerReleaseVersion', () => {
  it('compares semver-ish dotted versions', () => {
    expect(isNewerReleaseVersion('0.8.3', '0.8.2')).toBe(true);
    expect(isNewerReleaseVersion('0.8.2', '0.8.2')).toBe(false);
    expect(isNewerReleaseVersion('0.7.9', '0.8.0')).toBe(false);
    expect(isNewerReleaseVersion('v0.9.0-preview', '0.8.9')).toBe(true);
  });
});

describe('checkLatestReleaseVersion', () => {
  it('uses preview latest.json when channel is preview', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('desktop-latest-preview')) {
        return {
          ok: true,
          json: async () => ({ version: '0.8.3', platforms: {} }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const result = await checkLatestReleaseVersion({
      currentVersion: '0.8.0',
      channel: 'preview',
      fetchImpl,
    });

    expect(result).toEqual({
      latestVersion: '0.8.3',
      updateAvailable: true,
      checkError: null,
      source: 'preview',
      channel: 'preview',
    });
  });

  it('uses stable latest.json when channel is stable', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes('desktop-latest-preview')) {
        throw new Error('should not hit preview for stable channel');
      }
      if (href.includes('/releases/latest/download/latest.json')) {
        return {
          ok: true,
          json: async () => ({ version: '0.8.0', platforms: {} }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const result = await checkLatestReleaseVersion({
      currentVersion: '0.7.9',
      channel: 'stable',
      fetchImpl,
    });

    expect(result).toEqual({
      latestVersion: '0.8.0',
      updateAvailable: true,
      checkError: null,
      source: 'stable',
      channel: 'stable',
    });
  });

  it('falls back to GitHub API when channel json fails', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return {
          ok: true,
          json: async () => ({ tag_name: 'v0.8.1', name: 'v0.8.1' }),
        };
      }
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const result = await checkLatestReleaseVersion({
      currentVersion: '0.8.1',
      channel: 'preview',
      fetchImpl,
    });

    expect(result.latestVersion).toBe('0.8.1');
    expect(result.updateAvailable).toBe(false);
    expect(result.source).toBe('github-api');
    expect(result.channel).toBe('preview');
    expect(result.checkError).toBeNull();
  });

  it('returns a GitHub-oriented error when every endpoint fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const result = await checkLatestReleaseVersion({
      currentVersion: '0.8.0',
      fetchImpl,
    });

    expect(result).toEqual({
      latestVersion: null,
      updateAvailable: false,
      checkError: 'Unable to reach GitHub releases or mirrors',
      source: null,
      channel: 'preview',
    });
  });

  it('falls back to proxy latest.json when direct GitHub fails', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      // Direct GitHub endpoints fail
      const isDirectGitHub =
        (href.includes('github.com') || href.includes('api.github.com')) &&
        !href.includes('gh.llkk.cc') &&
        !href.includes('gh.ddlc.top') &&
        !href.includes('ghproxy.net') &&
        !href.includes('gh-proxy.com');
      if (isDirectGitHub) {
        throw new Error('ETIMEDOUT');
      }
      // Proxy latest.json via gh.llkk.cc succeeds
      if (href.includes('gh.llkk.cc') && href.includes('latest.json')) {
        return {
          ok: true,
          json: async () => ({ version: '0.8.4', platforms: {} }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const result = await checkLatestReleaseVersion({
      currentVersion: '0.8.0',
      channel: 'preview',
      fetchImpl,
    });

    expect(result.latestVersion).toBe('0.8.4');
    expect(result.updateAvailable).toBe(true);
    expect(result.source).toBe('preview-proxy');
    expect(result.checkError).toBeNull();
  });

  it('falls back to proxy GitHub API when both direct and proxy latest.json fail', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      // Direct GitHub endpoints fail (only match github.com / api.github.com, not proxy hosts)
      const isDirectGitHub =
        (href.includes('github.com') || href.includes('api.github.com')) &&
        !href.includes('gh.llkk.cc') &&
        !href.includes('gh.ddlc.top') &&
        !href.includes('ghproxy.net') &&
        !href.includes('gh-proxy.com');
      if (isDirectGitHub) {
        throw new Error('ETIMEDOUT');
      }
      // All proxy latest.json endpoints fail
      if (href.includes('latest.json')) {
        return { ok: false, json: async () => ({}) };
      }
      // Proxy GitHub API via ghproxy.net succeeds
      if (href.includes('ghproxy.net') && href.includes('api.github.com')) {
        return {
          ok: true,
          json: async () => ({ tag_name: 'v0.8.3' }),
        };
      }
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const result = await checkLatestReleaseVersion({
      currentVersion: '0.8.0',
      channel: 'preview',
      fetchImpl,
    });

    expect(result.latestVersion).toBe('0.8.3');
    expect(result.updateAvailable).toBe(true);
    expect(result.source).toBe('github-api-proxy');
    expect(result.checkError).toBeNull();
  });
});
