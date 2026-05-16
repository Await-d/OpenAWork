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

function deriveRepositoryUrl(rawRemote) {
  if (!rawRemote) return '';
  // Normalise common forms:
  //   git@github.com:Await-d/OpenAWork.git → https://github.com/Await-d/OpenAWork
  //   https://github.com/Await-d/OpenAWork.git → https://github.com/Await-d/OpenAWork
  const sshMatch = rawRemote.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  const httpsMatch = rawRemote.match(/^(https?:\/\/[^\s]+?)(\.git)?$/);
  if (httpsMatch) {
    return httpsMatch[1];
  }
  return rawRemote;
}

function getRecentCommits(limit = 20) {
  // Use a unit-separator + record-separator combo so messages with newlines
  // or pipes don't break parsing.
  const FIELD = '\u001f';
  const RECORD = '\u001e';
  const format = ['%h', '%H', '%cI', '%an', '%s'].join(FIELD);
  const raw = git(`git log -n ${limit} --pretty=format:"${format}${RECORD}"`);
  if (!raw) return [];

  return raw
    .split(RECORD)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [shortHash, fullHash, date, author, subject] = line.split(FIELD);
      return {
        shortHash: shortHash ?? '',
        fullHash: fullHash ?? '',
        date: date ?? '',
        author: author ?? '',
        subject: subject ?? '',
      };
    });
}

export function getVersionInfo() {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
  const baseVersion = pkg.version;

  const gitHash = git('git rev-parse --short HEAD') || 'unknown';
  const gitTag = git('git describe --tags --exact-match HEAD 2>/dev/null') || '';
  const isDirty = git('git status --porcelain') !== '';
  const branch = git('git rev-parse --abbrev-ref HEAD') || 'unknown';
  const buildTime = new Date().toISOString();
  const repositoryUrl = deriveRepositoryUrl(git('git config --get remote.origin.url'));
  const recentCommits = getRecentCommits(20);

  // User-facing version stays semver from package.json.
  // Build identity keeps git metadata for debugging and traceability.
  const buildVersion = gitTag || `${baseVersion}+${gitHash}${isDirty ? '.dirty' : ''}`;

  return {
    version: baseVersion,
    baseVersion,
    buildVersion,
    gitHash,
    gitTag,
    branch,
    isDirty,
    buildTime,
    repositoryUrl,
    recentCommits,
  };
}

// Print as JSON when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(getVersionInfo(), null, 2));
}
