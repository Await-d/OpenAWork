import { describe, expect, it } from 'vitest';
import { loadAppVersion } from '../../app-version.js';

describe('loadAppVersion', () => {
  it('prefers OPENAWORK_APP_VERSION env over package.json walk', () => {
    const version = loadAppVersion({
      env: { OPENAWORK_APP_VERSION: '9.9.9' },
      cwd: '/tmp/does-not-matter',
      readFile: () => JSON.stringify({ name: 'openAwork', version: '0.0.1' }),
    });
    expect(version).toBe('9.9.9');
  });

  it('falls back to root openAwork package.json when env is missing', () => {
    const readFile = (filePath: string) => {
      if (filePath === '/repo/package.json') {
        return JSON.stringify({ name: 'openAwork', version: '1.2.3' });
      }
      throw new Error(`unexpected read: ${filePath}`);
    };
    const version = loadAppVersion({
      env: {},
      cwd: '/repo/services/agent-gateway',
      readFile,
    });
    expect(version).toBe('1.2.3');
  });

  it('uses nearest package.json version when root openAwork is absent', () => {
    const readFile = (filePath: string) => {
      if (filePath === '/repo/services/agent-gateway/package.json') {
        return JSON.stringify({
          name: '@openAwork/agent-gateway',
          version: '0.5.2',
        });
      }
      throw new Error(`unexpected read: ${filePath}`);
    };
    const version = loadAppVersion({
      env: {},
      cwd: '/repo/services/agent-gateway',
      readFile,
    });
    expect(version).toBe('0.5.2');
  });

  it('falls back to npm_package_version when no package.json is reachable', () => {
    const version = loadAppVersion({
      env: { npm_package_version: '4.5.6' },
      cwd: '/var/empty',
      readFile: () => {
        throw new Error('no package.json');
      },
    });
    expect(version).toBe('4.5.6');
  });

  it('falls back to "0.0.1" when nothing else is available', () => {
    const version = loadAppVersion({
      env: {},
      cwd: '/var/empty',
      readFile: () => {
        throw new Error('no package.json');
      },
    });
    expect(version).toBe('0.0.1');
  });

  it('ignores empty/whitespace OPENAWORK_APP_VERSION', () => {
    const version = loadAppVersion({
      env: { OPENAWORK_APP_VERSION: '   ', npm_package_version: '7.8.9' },
      cwd: '/var/empty',
      readFile: () => {
        throw new Error('no package.json');
      },
    });
    expect(version).toBe('7.8.9');
  });
});
