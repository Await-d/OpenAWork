import * as path from 'node:path';
import * as os from 'node:os';
import { APP_NAME } from './platform-adapter.js';
import type { SupportedPlatform } from './platform-adapter.js';

export interface AgentSkillsPathsConfig {
  skillsPaths: string[];
}

function getAndroidPackageName(): string {
  const configured = process.env['ANDROID_PACKAGE']?.trim();
  return configured && configured.length > 0 ? configured : 'com.openAwork.mobile';
}

function getDefaultSkillsPaths(platform: SupportedPlatform): string[] {
  const envDir = process.env['CRUSH_SKILLS_DIR'] ?? process.env['OPENWORK_SKILLS_DIR'];

  const paths: string[] = [];

  if (envDir !== undefined && envDir.length > 0) {
    paths.push(envDir);
  }

  switch (platform) {
    case 'win32': {
      const appdata = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
      const localappdata =
        process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
      paths.push(
        path.join(appdata, APP_NAME, 'skills'),
        path.join(localappdata, APP_NAME, 'skills'),
        path.join(appdata, 'crush', 'skills'),
      );
      break;
    }
    case 'darwin':
      paths.push(
        path.join(os.homedir(), 'Library', 'Application Support', APP_NAME, 'skills'),
        path.join(os.homedir(), '.config', APP_NAME, 'skills'),
        path.join(os.homedir(), '.config', 'crush', 'skills'),
        path.join(os.homedir(), '.claude', 'skills'),
      );
      break;
    case 'android': {
      paths.push(path.join('/data', 'data', getAndroidPackageName(), 'files', 'config', 'skills'));
      break;
    }
    default:
      paths.push(
        path.join(
          process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config'),
          APP_NAME,
          'skills',
        ),
        path.join(
          process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config'),
          'crush',
          'skills',
        ),
        path.join(os.homedir(), '.claude', 'skills'),
        path.join(os.homedir(), '.agents', 'skills'),
      );
      break;
  }

  return paths;
}

export function resolveSkillsPaths(
  platform: SupportedPlatform,
  overrides?: string[],
): AgentSkillsPathsConfig {
  const defaults = getDefaultSkillsPaths(platform);
  const skillsPaths =
    overrides !== undefined && overrides.length > 0 ? [...overrides, ...defaults] : defaults;

  const seen = new Set<string>();
  const deduped = skillsPaths.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  return { skillsPaths: deduped };
}
