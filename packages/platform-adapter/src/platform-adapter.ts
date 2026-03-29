import * as os from 'node:os';
import * as path from 'node:path';

export const APP_NAME = 'OpenAWork';

export type SupportedPlatform =
  | 'darwin'
  | 'linux'
  | 'win32'
  | 'android'
  | 'freebsd'
  | 'openbsd'
  | 'netbsd';

export interface PlatformAdapter {
  getPlatform(): SupportedPlatform;
  getConfigDir(): string;
  getDataDir(): string;
  getTempDir(): string;
  getSkillsDir(): string;
}

function detectPlatform(): SupportedPlatform {
  if (process.env['ANDROID_DATA'] !== undefined || process.env['ANDROID_ROOT'] !== undefined) {
    return 'android';
  }
  const p = process.platform;
  if (
    p === 'darwin' ||
    p === 'linux' ||
    p === 'win32' ||
    p === 'freebsd' ||
    p === 'openbsd' ||
    p === 'netbsd'
  ) {
    return p;
  }
  return 'linux';
}

function getAndroidPackageName(): string {
  return process.env['ANDROID_PACKAGE'] ?? 'dev.openwork.app';
}

function resolveConfigDir(platform: SupportedPlatform): string {
  switch (platform) {
    case 'win32':
      return path.join(
        process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        APP_NAME,
      );
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
    case 'android':
      return path.join('/data', 'data', getAndroidPackageName(), 'files', 'config');
    default:
      return path.join(
        process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config'),
        APP_NAME,
      );
  }
}

function resolveDataDir(platform: SupportedPlatform): string {
  switch (platform) {
    case 'win32':
      return path.join(
        process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'),
        APP_NAME,
      );
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME, 'data');
    case 'android':
      return path.join('/data', 'data', getAndroidPackageName(), 'files', 'data');
    default:
      return path.join(
        process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share'),
        APP_NAME,
      );
  }
}

function resolveTempDir(platform: SupportedPlatform): string {
  if (platform === 'android') {
    return path.join('/data', 'data', getAndroidPackageName(), 'cache');
  }
  return path.join(os.tmpdir(), APP_NAME);
}

function resolveSkillsDir(platform: SupportedPlatform, configDir: string): string {
  return path.join(configDir, 'skills');
}

class DefaultPlatformAdapter implements PlatformAdapter {
  private readonly platform: SupportedPlatform;
  private readonly configDir: string;
  private readonly dataDir: string;
  private readonly tempDir: string;
  private readonly skillsDir: string;

  constructor() {
    this.platform = detectPlatform();
    this.configDir = resolveConfigDir(this.platform);
    this.dataDir = resolveDataDir(this.platform);
    this.tempDir = resolveTempDir(this.platform);
    this.skillsDir = resolveSkillsDir(this.platform, this.configDir);
  }

  getPlatform(): SupportedPlatform {
    return this.platform;
  }

  getConfigDir(): string {
    return this.configDir;
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getTempDir(): string {
    return this.tempDir;
  }

  getSkillsDir(): string {
    return this.skillsDir;
  }
}

export function createPlatformAdapter(): PlatformAdapter {
  return new DefaultPlatformAdapter();
}
