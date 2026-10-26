/**
 * 网关 sidecar 可执行文件名对齐检查。
 *
 * 为什么需要它：这个可执行文件横跨构建脚本、Tauri 打包配置、权限能力、Rust 启动
 * 代码、发布工作流与 Windows 资源元数据共 9 处，任何一处漏改都会以「运行时才暴露」
 * 的方式失败：
 * - externalBin 与 sidecar 名不一致 → 启动时报 sidecar not found；
 * - capabilities 未授权 → shell 插件拒绝执行；
 * - 发布工作流路径写错 → CI 冒烟测试找不到二进制；
 * - Linux 资源映射漏改 → 安装包里缺少 .gz 载荷，wrapper 直接 127 退出；
 * - Windows 元数据漏改 → 任务管理器里显示成「bun」和 Bun 的默认图标。
 *
 * 权威来源是 `apps/desktop/src-tauri/scripts/bundle-sidecar.mjs` 的
 * `GATEWAY_BINARY_NAME`（产出方），其余位置都必须与它一致。
 *
 * 该脚本不依赖 node_modules，可在 CI / lint-staged / 本地任意时机直接运行。
 * lint-staged 会把暂存文件名作为参数追加进来，本脚本忽略全部参数。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const BUILD_SCRIPT = 'apps/desktop/src-tauri/scripts/bundle-sidecar.mjs';
const GATEWAY_PACKAGE = 'services/agent-gateway/package.json';
const TAURI_CONF = 'apps/desktop/src-tauri/tauri.conf.json';
const TAURI_LINUX_CONF = 'apps/desktop/src-tauri/tauri.linux.conf.json';
const CAPABILITIES = 'apps/desktop/src-tauri/capabilities/default.json';
const GENERATED_CAPABILITIES = 'apps/desktop/src-tauri/gen/schemas/capabilities.json';
const RUST_ENTRY = 'apps/desktop/src-tauri/src/lib.rs';
const RELEASE_WORKFLOW = '.github/workflows/release-desktop.yml';
const NATIVE_CHECK_SCRIPT = 'scripts/check-desktop-native.mjs';

/** 名字字符集：允许字母数字与 `.` `_` `@` `-`，与 Tauri sidecar 名保持一致。 */
const NAME_PATTERN = String.raw`[\w.@-]+`;

const errors = [];
/** @type {{ source: string, name: string }[]} */
const observed = [];

function read(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function record(source, name, expectedDescription) {
  if (!name) {
    errors.push(`${source}: missing ${expectedDescription}`);
    return;
  }
  observed.push({ source, name });
}

/** 从 Tauri capabilities 的 permissions 数组里取出 sidecar 执行白名单。 */
function collectSidecarAllowNames(permissions) {
  const names = [];
  for (const permission of permissions ?? []) {
    if (typeof permission !== 'object' || permission === null) continue;
    if (permission.identifier !== 'shell:allow-execute') continue;
    for (const allow of permission.allow ?? []) {
      if (allow?.sidecar === true) names.push(allow.name);
    }
  }
  return names;
}

// 0. 产出方常量（权威来源）。
const buildScript = read(BUILD_SCRIPT);
const expectedName = buildScript.match(/const GATEWAY_BINARY_NAME = '([^']+)'/)?.[1] ?? null;
if (!expectedName) {
  errors.push(`${BUILD_SCRIPT}: missing \`const GATEWAY_BINARY_NAME = '<name>'\``);
}

// 1. bun compile 产物名。
const buildBinary = readJson(GATEWAY_PACKAGE).scripts?.['build:binary'] ?? '';
record(
  `${GATEWAY_PACKAGE}: scripts.build:binary`,
  buildBinary.match(new RegExp(String.raw`--outfile\s+dist/(${NAME_PATTERN})`))?.[1],
  '`--outfile dist/<name>`',
);

// 2. Tauri 打包的 externalBin。
const externalBin = readJson(TAURI_CONF).bundle?.externalBin?.[0] ?? '';
record(
  `${TAURI_CONF}: bundle.externalBin`,
  externalBin.match(new RegExp(String.raw`^binaries/(${NAME_PATTERN})$`))?.[1],
  '`binaries/<name>`',
);

// 3. Linux gzip 载荷的资源映射。
const linuxResources = readJson(TAURI_LINUX_CONF).bundle?.resources ?? {};
const gzipResourceKey = Object.keys(linuxResources).find((key) => key.endsWith('*.gz')) ?? '';
record(
  `${TAURI_LINUX_CONF}: bundle.resources`,
  gzipResourceKey.match(new RegExp(String.raw`^binaries/(${NAME_PATTERN})-\*\.gz$`))?.[1],
  '`binaries/<name>-*.gz`',
);

// 4. shell 插件白名单（源配置 + 提交进仓库的生成物）。
const capabilityNames = collectSidecarAllowNames(readJson(CAPABILITIES).permissions);
record(`${CAPABILITIES}: shell:allow-execute`, capabilityNames[0], 'sidecar allow entry');
if (capabilityNames.length > 1) {
  errors.push(
    `${CAPABILITIES}: shell:allow-execute declares multiple sidecars: ${capabilityNames.join(', ')}`,
  );
}

const generatedNames = collectSidecarAllowNames(
  readJson(GENERATED_CAPABILITIES).default?.permissions,
);
record(`${GENERATED_CAPABILITIES}: shell:allow-execute`, generatedNames[0], 'sidecar allow entry');

// 5. Rust 侧启动用的 sidecar 名（可能多处调用，全部必须一致）。
const rustSidecarNames = Array.from(
  read(RUST_ENTRY).matchAll(/\.sidecar\("([^"]+)"\)/g),
  (match) => match[1],
);
if (rustSidecarNames.length === 0) {
  errors.push(`${RUST_ENTRY}: missing \`.sidecar("<name>")\``);
} else {
  for (const name of rustSidecarNames) {
    record(`${RUST_ENTRY}: shell().sidecar(...)`, name, 'sidecar name');
  }
}

// 6. 发布工作流的冒烟测试路径。
record(
  `${RELEASE_WORKFLOW}: smoke test binary path`,
  read(RELEASE_WORKFLOW).match(
    new RegExp(String.raw`binaries/(${NAME_PATTERN})-\$\{TARGET_TRIPLE\}`),
  )?.[1],
  '`binaries/<name>-${TARGET_TRIPLE}`',
);

// 7. 本地 desktop-native 检查脚本的陈旧产物清理前缀。
record(
  `${NATIVE_CHECK_SCRIPT}: stale binary cleanup`,
  read(NATIVE_CHECK_SCRIPT).match(new RegExp(String.raw`startsWith\('(${NAME_PATTERN})-'\)`))?.[1],
  "`startsWith('<name>-')`",
);

// 8. 旧名残留（改名的常见遗漏：只在部分位置替换成新名）。
if (/dist\/agent-gateway|binaries\/agent-gateway/.test(buildScript)) {
  errors.push(`${BUILD_SCRIPT}: still references the legacy 'agent-gateway' binary path`);
}

// 9. Windows 资源元数据（任务管理器 / 文件属性展示用），打包脚本与发布校验必须同源。
const METADATA_FIELDS = [
  ['fileDescription', 'FileDescription', 'Windows 任务管理器「描述」与文件属性'],
  ['productName', 'ProductName', '产品名'],
  ['companyName', 'CompanyName', '公司名'],
];
const releaseWorkflow = read(RELEASE_WORKFLOW);
for (const [scriptField, workflowField, label] of METADATA_FIELDS) {
  const scriptValue = buildScript.match(new RegExp(`${scriptField}: '([^']+)'`))?.[1] ?? null;
  if (!scriptValue) {
    errors.push(`${BUILD_SCRIPT}: missing WINDOWS_EXE_METADATA.${scriptField}（${label}）`);
  }
  const workflowValue =
    releaseWorkflow.match(new RegExp(`${workflowField}\\s*=\\s*'([^']+)'`))?.[1] ?? null;
  if (!workflowValue) {
    errors.push(`${RELEASE_WORKFLOW}: missing \`${workflowField} = '<value>'\`（${label}）`);
  }
  if (scriptValue && workflowValue && scriptValue !== workflowValue) {
    errors.push(
      `${RELEASE_WORKFLOW}: ${workflowField}='${workflowValue}' (expected '${scriptValue}' from ${BUILD_SCRIPT})`,
    );
  }
}

const windowsIconPath = path.join(rootDir, 'apps/desktop/src-tauri/icons/icon.ico');
if (!existsSync(windowsIconPath)) {
  errors.push(
    `${path.relative(rootDir, windowsIconPath)}: missing Windows sidecar icon（任务管理器图标会退回 Bun 默认图标）`,
  );
}

// 汇总比对。
const referenceName = expectedName ?? observed[0]?.name ?? null;
if (referenceName) {
  for (const { source, name } of observed) {
    if (name !== referenceName) {
      errors.push(`${source}: '${name}' (expected '${referenceName}')`);
    }
  }
}

if (errors.length === 0) {
  process.stdout.write(
    `Gateway binary name alignment check passed (name: ${referenceName ?? '<unknown>'}).\n`,
  );
  process.exit(0);
}

process.stderr.write('Gateway binary name alignment check failed.\n\n');
for (const error of errors) {
  process.stderr.write(`- ${error}\n`);
}
process.stderr.write(
  '\nFix: run `bun run check:gateway-binary` after changing the gateway sidecar name, and keep\n' +
    `${BUILD_SCRIPT}, ${TAURI_CONF}, ${TAURI_LINUX_CONF}, ${CAPABILITIES},\n` +
    `${GENERATED_CAPABILITIES}, ${RUST_ENTRY}, ${RELEASE_WORKFLOW} and ${NATIVE_CHECK_SCRIPT}\n` +
    'in sync.\n',
);
process.exit(1);
