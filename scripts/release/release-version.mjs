#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const rootPackageJsonPath = resolve(rootDir, 'package.json');
const mobileAppJsonPath = resolve(rootDir, 'apps/mobile/app.json');
const desktopCargoTomlPath = resolve(rootDir, 'apps/desktop/src-tauri/Cargo.toml');

const workspaceRoots = ['apps', 'packages', 'services'];
const ignoredDirectories = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.agentdocs',
  '.evidence',
  'temp',
  'target',
  'binaries',
  'sidecars',
]);

function parseArgs(argv) {
  const options = {
    bump: 'auto',
    dryRun: false,
    json: false,
    exactVersion: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--bump') {
      options.bump = argv[index + 1] ?? options.bump;
      index += 1;
      continue;
    }
    if (!arg.startsWith('--')) {
      options.exactVersion = arg;
    }
  }

  return options;
}

function runGit(command) {
  try {
    return execSync(command, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value, dryRun) {
  if (dryRun) {
    return;
  }
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function collectWorkspacePackageJsonFiles() {
  const results = [rootPackageJsonPath];

  function walk(directoryPath) {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
        walk(resolve(directoryPath, entry.name));
        continue;
      }

      if (entry.isFile() && entry.name === 'package.json') {
        results.push(resolve(directoryPath, entry.name));
      }
    }
  }

  for (const workspaceRoot of workspaceRoots) {
    walk(resolve(rootDir, workspaceRoot));
  }

  return Array.from(new Set(results)).sort();
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported semver version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatSemver(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

function normalizeSemver(parts) {
  let major = parts.major;
  let minor = parts.minor;
  let patch = parts.patch;

  if (patch >= 10) {
    minor += Math.floor(patch / 10);
    patch %= 10;
  }

  if (minor >= 10) {
    major += Math.floor(minor / 10);
    minor %= 10;
  }

  return { major, minor, patch };
}

function bumpVersion(version, bump) {
  const parts = parseSemver(version);
  if (bump === 'major') {
    return formatSemver(normalizeSemver({ major: parts.major + 1, minor: 0, patch: 0 }));
  }
  if (bump === 'minor') {
    return formatSemver(normalizeSemver({ major: parts.major, minor: parts.minor + 1, patch: 0 }));
  }
  return formatSemver(
    normalizeSemver({
      major: parts.major,
      minor: parts.minor,
      patch: parts.patch + 1,
    }),
  );
}

function getLatestReleaseTag() {
  const output = runGit('git tag --sort=-version:refname');
  if (!output) {
    return null;
  }

  const tags = output
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => /^(desktop|mobile)-v\d+\.\d+\.\d+(?:-preview)?$/.test(tag));

  return tags[0] ?? null;
}

function getCommitMessagesSinceTag(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const output = runGit(`git log --format=%B%x1f ${range}`);
  if (!output) {
    return [];
  }

  return output
    .split('\x1f')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function inferBumpType(messages) {
  let hasMinor = false;

  for (const message of messages) {
    if (/BREAKING CHANGE:/m.test(message) || /^[a-z]+(?:\([^)]+\))?!:/m.test(message)) {
      return 'major';
    }

    if (/^feat(?:\([^)]+\))?:/m.test(message)) {
      hasMinor = true;
    }
  }

  return hasMinor ? 'minor' : 'patch';
}

function updatePackageJsonVersion(filePath, nextVersion, dryRun) {
  const data = readJson(filePath);
  if (data.version === nextVersion) {
    return false;
  }
  data.version = nextVersion;
  writeJson(filePath, data, dryRun);
  return true;
}

function updateMobileAppJsonVersion(nextVersion, dryRun) {
  const data = readJson(mobileAppJsonPath);
  if (data.expo?.version === nextVersion) {
    return false;
  }
  data.expo = {
    ...(data.expo ?? {}),
    version: nextVersion,
  };
  writeJson(mobileAppJsonPath, data, dryRun);
  return true;
}

function updateDesktopCargoVersion(nextVersion, dryRun) {
  const content = readFileSync(desktopCargoTomlPath, 'utf8');
  const updated = content.replace(
    /(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m,
    `$1${nextVersion}$3`,
  );

  if (updated === content) {
    return false;
  }

  if (!dryRun) {
    writeFileSync(desktopCargoTomlPath, updated, 'utf8');
  }

  return true;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const allowedBumps = new Set(['auto', 'patch', 'minor', 'major']);
  if (!allowedBumps.has(options.bump)) {
    throw new Error(`Unsupported bump type: ${options.bump}`);
  }

  const currentVersion = readJson(rootPackageJsonPath).version;
  const latestTag = getLatestReleaseTag();
  const commitMessages = getCommitMessagesSinceTag(latestTag);
  const inferredBump = inferBumpType(commitMessages);
  const resolvedBump = options.bump === 'auto' ? inferredBump : options.bump;
  const nextVersion = options.exactVersion
    ? formatSemver(normalizeSemver(parseSemver(options.exactVersion)))
    : bumpVersion(currentVersion, resolvedBump);

  if (options.exactVersion) {
    parseSemver(options.exactVersion);
  }

  const updatedFiles = [];
  for (const packageJsonPath of collectWorkspacePackageJsonFiles()) {
    if (updatePackageJsonVersion(packageJsonPath, nextVersion, options.dryRun)) {
      updatedFiles.push(packageJsonPath);
    }
  }

  if (existsSync(mobileAppJsonPath) && updateMobileAppJsonVersion(nextVersion, options.dryRun)) {
    updatedFiles.push(mobileAppJsonPath);
  }

  if (existsSync(desktopCargoTomlPath) && updateDesktopCargoVersion(nextVersion, options.dryRun)) {
    updatedFiles.push(desktopCargoTomlPath);
  }

  const result = {
    currentVersion,
    nextVersion,
    latestTag,
    bump: options.exactVersion ? 'set' : resolvedBump,
    inferredBump,
    dryRun: options.dryRun,
    updatedFiles: updatedFiles.map((filePath) => filePath.replace(`${rootDir}/`, '')),
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      `Current version: ${result.currentVersion}`,
      `Next version: ${result.nextVersion}`,
      `Latest release tag: ${result.latestTag ?? 'none'}`,
      `Bump: ${result.bump} (auto inferred: ${result.inferredBump})`,
      `Updated files: ${result.updatedFiles.length}`,
    ].join('\n') + '\n',
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
