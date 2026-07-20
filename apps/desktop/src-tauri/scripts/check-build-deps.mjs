import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

if (process.platform !== 'linux') {
  process.exit(0);
}

function hasCommand(command) {
  const pathValue = process.env.PATH ?? '';
  if (!pathValue) {
    return false;
  }

  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter((entry) => entry.length > 0)
      : [''];

  for (const directory of pathValue.split(delimiter)) {
    if (!directory) {
      continue;
    }

    for (const extension of extensions) {
      const candidate =
        process.platform === 'win32' && command.toLowerCase().endsWith(extension.toLowerCase())
          ? join(directory, command)
          : join(directory, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch (_error) {
        continue;
      }
    }
  }

  return false;
}

if (!hasCommand('pkg-config')) {
  console.error(`缺少 Linux 桌面打包依赖：pkg-config

请先安装以下依赖后再执行桌面打包：
  sudo apt-get update
  sudo apt-get install -y pkg-config libgtk-3-dev libglib2.0-dev libdbus-1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev fakeroot patchelf squashfs-tools appstream desktop-file-utils`);
  process.exit(1);
}

if (!hasCommand('fakeroot')) {
  console.error(`缺少 Linux deb 打包依赖：fakeroot

请先安装以下依赖后再执行桌面打包：
  sudo apt-get update
  sudo apt-get install -y pkg-config libgtk-3-dev libglib2.0-dev libdbus-1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev fakeroot patchelf squashfs-tools appstream desktop-file-utils`);
  process.exit(1);
}

if (!hasCommand('mksquashfs')) {
  console.error(`缺少 Linux AppImage 打包依赖：mksquashfs

请先安装以下依赖后再执行桌面打包：
  sudo apt-get update
  sudo apt-get install -y pkg-config libgtk-3-dev libglib2.0-dev libdbus-1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev fakeroot patchelf squashfs-tools appstream desktop-file-utils`);
  process.exit(1);
}

const requiredPackages = [
  'gtk+-3.0',
  'glib-2.0',
  'dbus-1',
  'webkit2gtk-4.1',
  'librsvg-2.0',
];
const missing = requiredPackages.filter((name) => {
  const result = spawnSync('pkg-config', ['--exists', name], { stdio: 'ignore' });
  return result.status !== 0;
});

const appIndicatorCandidates = ['appindicator3-0.1', 'ayatana-appindicator3-0.1'];
const hasSupportedAppIndicator = appIndicatorCandidates.some((name) => {
  const result = spawnSync('pkg-config', ['--exists', name], { stdio: 'ignore' });
  return result.status === 0;
});

if (!hasSupportedAppIndicator) {
  missing.push(appIndicatorCandidates.join('|'));
}

if (missing.length > 0) {
  console.error(`缺少 Linux 桌面打包依赖：${missing.join(' ')}

请先安装以下依赖后再执行桌面打包：
  sudo apt-get update
  sudo apt-get install -y pkg-config libgtk-3-dev libglib2.0-dev libdbus-1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev fakeroot patchelf squashfs-tools appstream desktop-file-utils`);
  process.exit(1);
}
