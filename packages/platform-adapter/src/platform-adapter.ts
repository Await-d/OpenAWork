import * as os from 'node:os';
import * as path from 'node:path';

export const APP_NAME = 'OpenAWork';

const DOCUMENTS_DIR_NAME = 'Documents';

export type SupportedPlatform =
  'darwin' | 'linux' | 'win32' | 'android' | 'freebsd' | 'openbsd' | 'netbsd';

export interface PlatformAdapter {
  getPlatform(): SupportedPlatform;
  getConfigDir(): string;
  getDataDir(): string;
  getTempDir(): string;
  getSkillsDir(): string;
  getDocumentsDir(): string;
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
  const configured = process.env['ANDROID_PACKAGE']?.trim();
  return configured && configured.length > 0 ? configured : 'com.openAwork.mobile';
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
      return path.posix.join('/data', 'data', getAndroidPackageName(), 'files', 'config');
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
      return path.posix.join('/data', 'data', getAndroidPackageName(), 'files', 'data');
    default:
      return path.join(
        process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share'),
        APP_NAME,
      );
  }
}

function resolveTempDir(platform: SupportedPlatform): string {
  if (platform === 'android') {
    return path.posix.join('/data', 'data', getAndroidPackageName(), 'cache');
  }
  return path.join(os.tmpdir(), APP_NAME);
}

function resolveSkillsDir(configDir: string, platform: SupportedPlatform): string {
  return platform === 'android'
    ? path.posix.join(configDir, 'skills')
    : path.join(configDir, 'skills');
}

function resolveDocumentsDir(platform: SupportedPlatform): string {
  switch (platform) {
    case 'win32':
      return path.join(process.env['USERPROFILE'] ?? os.homedir(), DOCUMENTS_DIR_NAME);
    case 'darwin':
      return path.join(os.homedir(), DOCUMENTS_DIR_NAME);
    case 'android':
      // Android 无标准公共「文档目录」，退回应用私有数据目录。
      return resolveDataDir(platform);
    default:
      return process.env['XDG_DOCUMENTS_DIR'] ?? path.join(os.homedir(), DOCUMENTS_DIR_NAME);
  }
}

class DefaultPlatformAdapter implements PlatformAdapter {
  private readonly platform: SupportedPlatform;
  private readonly configDir: string;
  private readonly dataDir: string;
  private readonly tempDir: string;
  private readonly skillsDir: string;
  private readonly documentsDir: string;

  constructor() {
    this.platform = detectPlatform();
    this.configDir = resolveConfigDir(this.platform);
    this.dataDir = resolveDataDir(this.platform);
    this.tempDir = resolveTempDir(this.platform);
    this.skillsDir = resolveSkillsDir(this.configDir, this.platform);
    this.documentsDir = resolveDocumentsDir(this.platform);
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

  getDocumentsDir(): string {
    return this.documentsDir;
  }
}

export function createPlatformAdapter(): PlatformAdapter {
  return new DefaultPlatformAdapter();
}
