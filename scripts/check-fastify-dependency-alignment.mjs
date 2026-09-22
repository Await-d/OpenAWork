import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const gatewayPackagePath = path.join(rootDir, 'services/agent-gateway/package.json');
const lockfilePath = path.join(rootDir, 'bun.lock');
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

/**
 * 去掉 JSONC 的尾随逗号（bun.lock 是带尾逗号的文本锁文件）。
 * 逐字符扫描并跟踪字符串状态，避免误伤字符串字面量里的 `,}` / `,]`。
 */
function stripTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ',') {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) {
        next += 1;
      }
      if (text[next] === '}' || text[next] === ']') {
        continue;
      }
      out += char;
      continue;
    }

    out += char;
  }

  return out;
}

/**
 * 收集 bun.lock 中每个依赖名解析出的版本集合。
 * 结构说明：lockfile.packages 的键是「提升路径」（含嵌套，如 `@fastify/swagger/fastify-plugin`），
 * 真正的包名与版本在值的首项，形如 `fastify@5.12.5` 或 `drizzle-orm@0.36.4+<hash>`。
 */
function collectLockfileVersions(dependencyNames) {
  const lockfile = JSON.parse(stripTrailingCommas(readFileSync(lockfilePath, 'utf8')));
  const packages = lockfile.packages ?? {};
  const versionsByName = new Map(dependencyNames.map((name) => [name, new Set()]));

  for (const value of Object.values(packages)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const spec = value[0];
    if (typeof spec !== 'string') {
      continue;
    }
    const separatorIndex = spec.lastIndexOf('@');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = spec.slice(0, separatorIndex);
    const version = spec.slice(separatorIndex + 1).split('+')[0];
    const bucket = versionsByName.get(name);
    if (bucket && version) {
      bucket.add(version);
    }
  }

  return versionsByName;
}

function collectLockfileErrors() {
  if (!existsSync(lockfilePath)) {
    return ['bun.lock 不存在，请先执行 `bun install` 生成锁文件。'];
  }

  const versionsByName = collectLockfileVersions(lockfileUniqueDependencies);
  const errors = [];

  for (const [dependencyName, versions] of versionsByName) {
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
