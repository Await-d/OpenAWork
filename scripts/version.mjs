/**
 * Version generation script
 * Reads from root package.json + git metadata
 * Usage: node scripts/version.mjs
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function git(cmd) {
  try {
    return execSync(cmd, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

export function getVersionInfo() {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
  const baseVersion = pkg.version;

  const gitHash = git('git rev-parse --short HEAD') || 'unknown';
  const gitTag = git('git describe --tags --exact-match HEAD 2>/dev/null') || '';
  const isDirty = git('git status --porcelain') !== '';
  const branch = git('git rev-parse --abbrev-ref HEAD') || 'unknown';
  const buildTime = new Date().toISOString();

  // If on an exact tag, use it; otherwise base version + commit
  const version = gitTag || `${baseVersion}+${gitHash}${isDirty ? '.dirty' : ''}`;

  return {
    version,
    baseVersion,
    gitHash,
    gitTag,
    branch,
    isDirty,
    buildTime,
  };
}

// Print as JSON when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(getVersionInfo(), null, 2));
}
