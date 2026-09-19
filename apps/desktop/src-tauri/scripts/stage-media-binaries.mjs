import { copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// Stage ffmpeg / ffprobe so packaged desktop builds resolve them via
// OPENAWORK_RESOURCES_DIR → <resource_dir>/gateway-resources/media/<name>.
// tauri.conf.json maps packages/resources/resources/ to gateway-resources/.
//
// Target detection: desktop release jobs export TAURI_TARGET_TRIPLE (needed for
// cross-target builds, e.g. x86_64-apple-darwin on an arm64 runner). Without
// it we fall back to the host platform/arch.
//
// Windows currently ships x64 media binaries only — the win32 arm64 build
// relies on OS x64 emulation, so both Windows targets stage the same files.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '../../../..');
const gatewayNodeModules = resolve(root, 'services/agent-gateway/node_modules');
const targetDir = resolve(root, 'packages/resources/resources/media');

const rawTriple = (process.env.TAURI_TARGET_TRIPLE ?? '').trim().toLowerCase();

function detectPlatform() {
  if (rawTriple.includes('pc-windows') || rawTriple.includes('windows')) return 'win32';
  if (rawTriple.includes('apple') || rawTriple.includes('darwin')) return 'darwin';
  if (rawTriple.includes('linux')) return 'linux';
  if (rawTriple) {
    console.warn(
      `Warning: Unrecognized TAURI_TARGET_TRIPLE "${rawTriple}", falling back to host platform.`,
    );
  }
  return process.platform;
}

function detectArch() {
  if (rawTriple.includes('aarch64') || rawTriple.includes('arm64')) return 'arm64';
  if (rawTriple.includes('x86_64') || rawTriple.includes('x64') || rawTriple.includes('amd64')) {
    return 'x64';
  }
  if (rawTriple) {
    console.warn(
      `Warning: Unrecognized architecture in TAURI_TARGET_TRIPLE "${rawTriple}", falling back to host arch.`,
    );
  }
  return process.arch;
}

const platform = detectPlatform();
const arch = detectArch();
const crossTarget = platform !== process.platform || arch !== process.arch;

if (crossTarget) {
  console.log(
    `Cross-target staging: host ${process.platform}/${process.arch} → target ${platform}/${arch}`,
  );
}

function createBinaryPlan() {
  if (platform === 'win32') {
    // ffprobe-static publishes win32/x64 (and ia32) only; Windows arm64 runs
    // the x64 build through emulation, matching ffmpeg-static's win32/x64.
    return [
      {
        destName: 'ffmpeg.exe',
        source: resolve(gatewayNodeModules, 'ffmpeg-static/ffmpeg.exe'),
        packageName: 'ffmpeg-static',
        rebuildArch: 'x64',
      },
      {
        destName: 'ffprobe.exe',
        source: resolve(gatewayNodeModules, 'ffprobe-static/bin/win32/x64/ffprobe.exe'),
        packageName: 'ffprobe-static',
        rebuildArch: 'x64',
      },
    ];
  }

  return [
    {
      destName: 'ffmpeg',
      // ffmpeg-static installs a single binary at the package root; on a
      // cross-target build it must be re-fetched for the requested arch.
      source: resolve(gatewayNodeModules, 'ffmpeg-static/ffmpeg'),
      packageName: 'ffmpeg-static',
      rebuildArch: arch,
    },
    {
      destName: 'ffprobe',
      source: resolve(gatewayNodeModules, `ffprobe-static/bin/${platform}/${arch}/ffprobe`),
      packageName: 'ffprobe-static',
      rebuildArch: arch,
      // ffprobe-static ships no linux/arm64 binary; a rebuild cannot create it.
      knownUnavailable:
        platform === 'linux' && arch === 'arm64'
          ? 'ffprobe-static does not publish a linux/arm64 binary'
          : undefined,
    },
  ];
}

const binaries = createBinaryPlan();

for (const binary of binaries) {
  if (binary.knownUnavailable) continue;

  const sourceExists = existsSync(binary.source);
  // A cross-target ffmpeg-static keeps the host-installed binary at the same
  // path, so its filename proves nothing — force a re-fetch and verify below.
  // ffprobe-static ships every platform in its tarball, so its target-specific
  // path already proves the binary is the right one.
  const needsTargetRefresh = crossTarget && binary.packageName === 'ffmpeg-static';
  if (sourceExists && !needsTargetRefresh) continue;

  const mtimeBefore = sourceExists ? statSync(binary.source).mtimeMs : null;
  console.log(
    sourceExists
      ? `${binary.destName} is not staged for ${platform}/${arch}, rebuilding ${binary.packageName}...`
      : `Missing ${binary.destName}, attempting to rebuild ${binary.packageName}...`,
  );
  try {
    execSync(`pnpm rebuild ${binary.packageName}`, {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_arch: binary.rebuildArch,
        npm_config_platform: platform,
      },
    });
  } catch (e) {
    console.warn(`Warning: Failed to rebuild ${binary.packageName}: ${e.message}`);
  }

  if (needsTargetRefresh) {
    // ffmpeg-static's installer exits early when a file already sits at the
    // computed path, so an unchanged mtime means the binary is still the
    // host one and must not be staged under another target's name.
    const refreshed =
      existsSync(binary.source) &&
      (mtimeBefore === null || statSync(binary.source).mtimeMs !== mtimeBefore);
    if (!refreshed) {
      binary.staleForTarget = true;
    }
  }
}

const missing = binaries.filter(
  (binary) => binary.staleForTarget || !existsSync(binary.source),
);
if (missing.length > 0) {
  for (const binary of missing) {
    if (binary.knownUnavailable) {
      console.warn(
        `Warning: ${binary.destName} unavailable for ${platform}/${arch}: ${binary.knownUnavailable}.`,
      );
    } else if (binary.staleForTarget) {
      console.warn(
        `Warning: ${binary.destName} is still built for a different platform/arch; refusing to stage it for ${platform}/${arch}.`,
      );
    }
  }
  console.warn(
    `Warning: Missing ${platform}/${arch} media binaries: ${missing
      .map((binary) => binary.destName)
      .join(', ')}`,
  );
  console.warn('Media features (video/audio) will be disabled in this build.');
  // Keep the directory present so the Tauri resource mapping still resolves.
  await mkdir(targetDir, { recursive: true });
  process.exit(0);
}

await mkdir(targetDir, { recursive: true });
await Promise.all(
  binaries.map(async (binary) => {
    const destination = resolve(targetDir, binary.destName);
    await rm(destination, { force: true });
    await copyFile(binary.source, destination);
  }),
);

console.log(`Staged ${platform}/${arch} media binaries: ${targetDir}`);
