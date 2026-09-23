/**
 * Docker 版本对齐检查。
 *
 * 不变量（防止多处版本副本漂移）：
 * 1. `.bun-version` 是 bun 工具链的唯一事实来源，必须与两个 Dockerfile 的
 *    `ARG BUN_VERSION` 默认值一致；
 * 2. 根 package.json 的 `packageManager` 必须为 `bun@<.bun-version>`；
 * 3. `docker-compose.yml` 中 gateway 构建参数的 `${VAR:-default}` 默认值必须与
 *    `services/agent-gateway/Dockerfile` 的 `ARG VAR=default` 一致。
 *
 * 该脚本不依赖 node_modules，可在 CI / lint-staged / 本地任意时机直接运行。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const bunVersionPath = path.join(rootDir, '.bun-version');
const composePath = path.join(rootDir, 'docker-compose.yml');
const rootPackageJsonPath = path.join(rootDir, 'package.json');
const gatewayDockerfile = 'services/agent-gateway/Dockerfile';
const webDockerfile = 'apps/web/Dockerfile';

/** 必须出现在 compose 构建参数里的变量（与 Dockerfile 一一对应）。 */
const requiredComposeArgs = [
  'BUN_VERSION',
  'NODE_VERSION',
  'OPENAWORK_VERSION',
  'OPENAWORK_GIT_SHA',
];

/** 读取 Dockerfile 里所有 `ARG NAME=value` 默认值（同名 ARG 可能跨阶段重复声明）。 */
function readDockerfileArgs(relativePath) {
  const content = readFileSync(path.join(rootDir, relativePath), 'utf8');
  const args = new Map();

  for (const match of content.matchAll(/^ARG\s+([A-Z][A-Z0-9_]*)=(\S+)\s*$/gm)) {
    const [, name, value] = match;
    const values = args.get(name) ?? new Set();
    values.add(value);
    args.set(name, values);
  }

  return args;
}

/** 读取 compose 文件里 `${NAME:-default}` 形式的插值默认值。 */
function readComposeArgDefaults() {
  const content = readFileSync(composePath, 'utf8');
  const defaults = new Map();

  for (const match of content.matchAll(/\$\{([A-Z][A-Z0-9_]*):-([^}]*)\}/g)) {
    const [, name, value] = match;
    const values = defaults.get(name) ?? new Set();
    values.add(value);
    defaults.set(name, values);
  }

  return defaults;
}

function formatValues(values) {
  return Array.from(values)
    .map((value) => `'${value}'`)
    .join(', ');
}

function checkSingleValue(errors, args, name, source) {
  const values = args.get(name);
  if (!values) {
    errors.push(`${source}: missing ARG ${name}`);
    return null;
  }
  if (values.size > 1) {
    errors.push(
      `${source}: ARG ${name} declared with conflicting defaults: ${formatValues(values)}`,
    );
    return null;
  }
  return Array.from(values)[0];
}

const errors = [];

const bunVersion = readFileSync(bunVersionPath, 'utf8').trim();
if (!bunVersion) {
  errors.push('.bun-version is empty');
}

const gatewayArgs = readDockerfileArgs(gatewayDockerfile);
const webArgs = readDockerfileArgs(webDockerfile);
const composeDefaults = readComposeArgDefaults();

// 1. `.bun-version` ↔ 两个 Dockerfile 的 BUN_VERSION
for (const [label, args] of [
  [gatewayDockerfile, gatewayArgs],
  [webDockerfile, webArgs],
]) {
  const value = checkSingleValue(errors, args, 'BUN_VERSION', label);
  if (bunVersion && value && value !== bunVersion) {
    errors.push(`${label}: ARG BUN_VERSION=${value} (expected ${bunVersion} from .bun-version)`);
  }
}

// 2. packageManager ↔ `.bun-version`
const packageManager = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8')).packageManager;
if (bunVersion && packageManager !== `bun@${bunVersion}`) {
  errors.push(
    `package.json: packageManager=${packageManager ?? '<missing>'} (expected bun@${bunVersion} from .bun-version)`,
  );
}

// 3. compose 构建参数默认值 ↔ gateway Dockerfile
for (const name of requiredComposeArgs) {
  const dockerfileValue = checkSingleValue(errors, gatewayArgs, name, gatewayDockerfile);
  const composeValue = checkSingleValue(errors, composeDefaults, name, 'docker-compose.yml');

  if (dockerfileValue && composeValue && dockerfileValue !== composeValue) {
    errors.push(
      `docker-compose.yml: \${${name}:-${composeValue}} does not match ${gatewayDockerfile} ARG ${name}=${dockerfileValue}`,
    );
  }
}

if (errors.length === 0) {
  process.stdout.write('Docker version alignment check passed.\n');
  process.exit(0);
}

process.stderr.write('Docker version alignment check failed.\n\n');
for (const error of errors) {
  process.stderr.write(`- ${error}\n`);
}
process.stderr.write(
  '\nFix: keep .bun-version, Dockerfiles, docker-compose.yml and packageManager in sync.\n',
);
process.exit(1);
