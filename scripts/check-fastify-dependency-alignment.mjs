import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const gatewayPackagePath = path.join(rootDir, 'services/agent-gateway/package.json');
const canonicalPackageJson = JSON.parse(readFileSync(gatewayPackagePath, 'utf8'));
const manifestAlignedDependencies = [
  'fastify',
  'fastify-plugin',
  '@fastify/jwt',
  '@fastify/swagger',
  '@fastify/swagger-ui',
  '@fastify/websocket',
];
const lockfileUniqueDependencies = [
  'fastify',
  '@fastify/jwt',
  '@fastify/swagger',
  '@fastify/swagger-ui',
  '@fastify/websocket',
];
const dependencySections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function listWorkspacePackageJsons() {
  const workspaceRoots = ['apps', 'packages', 'services'];
  const files = ['package.json'];

  for (const workspaceRoot of workspaceRoots) {
    const absoluteRoot = path.join(rootDir, workspaceRoot);
    for (const entry of readdirSync(absoluteRoot)) {
      const manifestPath = path.join(absoluteRoot, entry, 'package.json');
      if (!existsSync(manifestPath)) {
        continue;
      }

      if (statSync(manifestPath).isFile()) {
        files.push(path.relative(rootDir, manifestPath));
      }
    }
  }

  return files;
}

function collectManifestErrors() {
  const canonicalVersions = Object.fromEntries(
    manifestAlignedDependencies.map((dependencyName) => [
      dependencyName,
      canonicalPackageJson.dependencies?.[dependencyName] ??
        canonicalPackageJson.devDependencies?.[dependencyName] ??
        canonicalPackageJson.peerDependencies?.[dependencyName] ??
        canonicalPackageJson.optionalDependencies?.[dependencyName] ??
        null,
    ]),
  );
  const errors = [];

  for (const relativeManifestPath of listWorkspacePackageJsons()) {
    if (relativeManifestPath === 'services/agent-gateway/package.json') {
      continue;
    }

    const manifest = JSON.parse(readFileSync(path.join(rootDir, relativeManifestPath), 'utf8'));

    for (const section of dependencySections) {
      const dependencies = manifest[section];
      if (!dependencies || typeof dependencies !== 'object') {
        continue;
      }

      for (const dependencyName of manifestAlignedDependencies) {
        const expectedVersion = canonicalVersions[dependencyName];
        const actualVersion = dependencies[dependencyName];
        if (!expectedVersion || !actualVersion) {
          continue;
        }
        if (actualVersion !== expectedVersion) {
          errors.push(
            `${relativeManifestPath} -> ${section}.${dependencyName} = ${actualVersion} (expected ${expectedVersion})`,
          );
        }
      }
    }
  }

  return errors;
}

function collectLockfileErrors() {
  const lockfileText = readFileSync(path.join(rootDir, 'pnpm-lock.yaml'), 'utf8');
  const errors = [];

  for (const dependencyName of lockfileUniqueDependencies) {
    const escapedDependencyName = dependencyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(`^  ${escapedDependencyName}@([^:(\\n]+)`, 'gm');
    const versions = new Set();

    for (const match of lockfileText.matchAll(matcher)) {
      const version = match[1]?.trim();
      if (version) {
        versions.add(version);
      }
    }

    if (versions.size > 1) {
      errors.push(
        `${dependencyName} resolved to multiple versions: ${Array.from(versions).join(', ')}`,
      );
    }
  }

  return errors;
}

const manifestErrors = collectManifestErrors();
const lockfileErrors = collectLockfileErrors();

if (manifestErrors.length === 0 && lockfileErrors.length === 0) {
  process.stdout.write('Fastify dependency alignment check passed.\n');
  process.exit(0);
}

process.stderr.write('Fastify dependency alignment check failed.\n');

if (manifestErrors.length > 0) {
  process.stderr.write('\nManifest mismatches:\n');
  for (const error of manifestErrors) {
    process.stderr.write(`- ${error}\n`);
  }
}

if (lockfileErrors.length > 0) {
  process.stderr.write('\nLockfile mismatches:\n');
  for (const error of lockfileErrors) {
    process.stderr.write(`- ${error}\n`);
  }
}

process.exit(1);
