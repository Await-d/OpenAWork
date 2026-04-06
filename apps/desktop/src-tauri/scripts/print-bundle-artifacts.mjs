import { existsSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const bundleRoot = resolve(scriptDir, '../target/release/bundle');
const installerExtensions = new Set([
  '.appimage',
  '.deb',
  '.dmg',
  '.exe',
  '.msi',
  '.rpm',
  '.sig',
]);

function collectArtifacts(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const artifacts = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...collectArtifacts(fullPath));
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (installerExtensions.has(extension)) {
      artifacts.push(fullPath);
    }
  }

  return artifacts;
}

if (!existsSync(bundleRoot)) {
  console.log(`桌面打包已完成，但未找到 bundle 目录：${bundleRoot}`);
  process.exit(0);
}

const artifacts = collectArtifacts(bundleRoot).sort((left, right) => left.localeCompare(right));

if (artifacts.length === 0) {
  console.log(`桌面打包已完成，bundle 目录存在但未识别到安装包文件：${bundleRoot}`);
  process.exit(0);
}

console.log('桌面安装包输出：');
for (const artifact of artifacts) {
  console.log(`- ${relative(process.cwd(), artifact)}`);
}
