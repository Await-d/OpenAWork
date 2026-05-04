import { spawnSync } from 'node:child_process';

if (process.platform !== 'linux') {
  process.exit(0);
}

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

if (!hasCommand('pkg-config')) {
  console.error(`缺少 Linux 桌面打包依赖：pkg-config

请先安装以下依赖后再执行桌面打包：
  sudo apt-get update
  sudo apt-get install -y pkg-config libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`);
  process.exit(1);
}

const requiredPackages = ['glib-2.0', 'webkit2gtk-4.1', 'appindicator3-0.1', 'librsvg-2.0'];
const missing = requiredPackages.filter((name) => {
  const result = spawnSync('pkg-config', ['--exists', name], { stdio: 'ignore' });
  return result.status !== 0;
});

if (missing.length > 0) {
  console.error(`缺少 Linux 桌面打包依赖：${missing.join(' ')}

请先安装以下依赖后再执行桌面打包：
  sudo apt-get update
  sudo apt-get install -y pkg-config libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`);
  process.exit(1);
}
