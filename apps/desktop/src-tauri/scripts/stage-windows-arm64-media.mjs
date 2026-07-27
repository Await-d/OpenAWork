import { copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '../../../..');
const gatewayNodeModules = resolve(root, 'services/agent-gateway/node_modules');
const targetDir = resolve(scriptDir, '../resources/media');

const binaries = [
  {
    name: 'ffmpeg.exe',
    source: resolve(gatewayNodeModules, 'ffmpeg-static/ffmpeg.exe'),
    packageName: 'ffmpeg-static',
  },
  {
    name: 'ffprobe.exe',
    source: resolve(gatewayNodeModules, 'ffprobe-static/bin/win32/x64/ffprobe.exe'),
    packageName: 'ffprobe-static',
  },
];

// Try to rebuild missing binaries
for (const binary of binaries) {
  if (!existsSync(binary.source)) {
    console.log(`Missing ${binary.name}, attempting to rebuild ${binary.packageName}...`);
    try {
      execSync(`pnpm rebuild ${binary.packageName}`, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, npm_config_arch: 'x64' },
      });
    } catch (e) {
      console.warn(`Warning: Failed to rebuild ${binary.packageName}: ${e.message}`);
    }
  }
}

// Verify binaries exist after rebuild attempt
const missing = binaries.filter((b) => !existsSync(b.source));
if (missing.length > 0) {
  console.warn(`Warning: Missing Windows x64 media binaries: ${missing.map((b) => b.name).join(', ')}`);
  console.warn('Media features (video/audio) will be disabled in this build.');
  // Create empty target directory to allow build to continue
  await mkdir(targetDir, { recursive: true });
  process.exit(0);
}

await mkdir(targetDir, { recursive: true });
await Promise.all(
  binaries.map(async (binary) => {
    const destination = resolve(targetDir, binary.name);
    await rm(destination, { force: true });
    await copyFile(binary.source, destination);
  }),
);

console.log(`Staged Windows ARM64-compatible media binaries: ${targetDir}`);
