import { copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '../../../..');
const gatewayNodeModules = resolve(root, 'services/agent-gateway/node_modules');
const targetDir = resolve(scriptDir, '../resources/media');

const binaries = [
  {
    name: 'ffmpeg.exe',
    source: resolve(gatewayNodeModules, 'ffmpeg-static/ffmpeg.exe'),
  },
  {
    name: 'ffprobe.exe',
    source: resolve(gatewayNodeModules, 'ffprobe-static/bin/win32/x64/ffprobe.exe'),
  },
];

for (const binary of binaries) {
  if (!existsSync(binary.source)) {
    throw new Error(`Missing Windows x64 media binary: ${binary.source}`);
  }
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
