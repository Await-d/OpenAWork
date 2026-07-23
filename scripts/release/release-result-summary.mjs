#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const channelLabels = {
  preview: '预览',
  production: '正式',
  stable: '稳定',
};

const targetLabels = {
  desktop: '桌面端',
  mobile: '移动端',
};

const resultSectionTitles = {
  desktop: '平台安装包下载',
  mobile: '移动端安装包 / 构建产物',
};

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = '';
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return { command, options };
}

function readTextFile(filePath) {
  if (!filePath) {
    throw new Error('缺少文件路径参数。');
  }
  if (!existsSync(filePath)) {
    throw new Error(`文件不存在：${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

function readOptionalJson(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function normalizeTarget(target) {
  if (target === 'desktop' || target === 'mobile') {
    return target;
  }
  throw new Error(`不支持的发布目标：${target}`);
}

function normalizeChannel(channel) {
  if (!channel) {
    return null;
  }

  if (channel === 'preview' || channel === 'production' || channel === 'stable') {
    return channel;
  }

  throw new Error(`不支持的发布渠道：${channel}`);
}

function normalizeVersion(version) {
  if (!version) {
    return null;
  }

  const trimmed = version.trim();
  const tagMatch = /^(?:desktop|mobile)-v(\d+\.\d+\.\d+)(?:-preview)?$/.exec(trimmed);
  if (tagMatch) {
    return `v${tagMatch[1]}`;
  }

  if (/^v\d+\.\d+\.\d+$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return `v${trimmed}`;
  }

  return trimmed;
}

/**
 * 将桌面安装包资产归类到「架构 × 平台格式」格子，用于生成类似 RustDesk 的下载表。
 * 忽略 .sig / .json（updater 元数据）等非安装包文件。
 *
 * @returns {{
 *   windows: { x64?: {label:string,url:string}, arm64?: {label:string,url:string} },
 *   macos: { x64?: Array<{label:string,url:string}>, arm64?: Array<{label:string,url:string}> },
 *   linuxDeb: { x64?: {label:string,url:string}, arm64?: {label:string,url:string} },
 *   linuxAppImage: { x64?: {label:string,url:string}, arm64?: {label:string,url:string} },
 *   other: Array<{name:string,url:string}>,
 * }}
 */
function classifyDesktopAssets(assets) {
  const grid = {
    windows: {},
    macos: { x64: [], arm64: [] },
    linuxDeb: {},
    linuxAppImage: {},
    other: [],
  };

  for (const asset of assets) {
    const name = String(asset?.name ?? '');
    const url = String(asset?.browser_download_url ?? '');
    if (!name || !url) continue;
    if (name.endsWith('.sig') || name.endsWith('.json')) continue;

    const lower = name.toLowerCase();

    // Windows NSIS installer
    if (lower.endsWith('-setup.exe') || lower.endsWith('.exe')) {
      if (lower.includes('arm64') || lower.includes('aarch64')) {
        grid.windows.arm64 = { label: 'EXE', url };
        continue;
      }
      if (lower.includes('x64') || lower.includes('x86_64') || lower.includes('amd64')) {
        grid.windows.x64 = { label: 'EXE', url };
        continue;
      }
    }

    // macOS DMG / app.tar.gz
    if (lower.endsWith('.dmg') || lower.endsWith('.app.tar.gz')) {
      const label = lower.endsWith('.dmg') ? 'DMG' : 'App';
      const arch =
        lower.includes('x64') || lower.includes('x86_64') || lower.includes('amd64')
          ? 'x64'
          : 'arm64'; // 当前默认产物是 aarch64
      grid.macos[arch].push({ label, url });
      continue;
    }

    // Linux deb
    if (lower.endsWith('.deb')) {
      if (lower.includes('arm64') || lower.includes('aarch64')) {
        grid.linuxDeb.arm64 = { label: 'DEB', url };
        continue;
      }
      if (lower.includes('amd64') || lower.includes('x86_64') || lower.includes('x64')) {
        grid.linuxDeb.x64 = { label: 'DEB', url };
        continue;
      }
    }

    // Linux AppImage
    if (lower.endsWith('.appimage')) {
      if (lower.includes('aarch64') || lower.includes('arm64')) {
        grid.linuxAppImage.arm64 = { label: 'AppImage', url };
        continue;
      }
      if (lower.includes('amd64') || lower.includes('x86_64') || lower.includes('x64')) {
        grid.linuxAppImage.x64 = { label: 'AppImage', url };
        continue;
      }
    }

    grid.other.push({ name, url });
  }

  return grid;
}

function formatCellLinks(links) {
  if (!links || (Array.isArray(links) && links.length === 0)) {
    return '';
  }
  const items = Array.isArray(links) ? links : [links];
  return items.map((item) => `[${item.label}](${item.url})`).join(' &nbsp; ');
}

/**
 * 生成类似 RustDesk 的安装包下载 Markdown 表格：
 * 行 = 架构，列 = Windows / macOS / Ubuntu(deb) / AppImage
 */
function buildDesktopDownloadTable(grid) {
  const rows = [
    '| 架构 | Windows | macOS | Ubuntu | AppImage |',
    '|------|---------|-------|--------|----------|',
  ];

  const archRows = [
    {
      title: 'x86-64 (64-bit)',
      windows: grid.windows.x64,
      macos: grid.macos.x64,
      deb: grid.linuxDeb.x64,
      appimage: grid.linuxAppImage.x64,
    },
    {
      title: 'AArch64 (ARM64)',
      windows: grid.windows.arm64,
      macos: grid.macos.arm64,
      deb: grid.linuxDeb.arm64,
      appimage: grid.linuxAppImage.arm64,
    },
  ];

  let hasAny = false;
  for (const row of archRows) {
    const cells = [
      formatCellLinks(row.windows),
      formatCellLinks(row.macos),
      formatCellLinks(row.deb),
      formatCellLinks(row.appimage),
    ];
    if (cells.some((cell) => cell.length > 0)) {
      hasAny = true;
      rows.push(`| ${row.title} | ${cells.join(' | ')} |`);
    }
  }

  return hasAny ? rows : null;
}

function buildDesktopResultLines(release) {
  if (!release) {
    return ['- 当前未找到 GitHub Release 资产信息。'];
  }

  const lines = [];
  if (typeof release.html_url === 'string' && release.html_url.length > 0) {
    lines.push(`- GitHub Release：${release.html_url}`);
    lines.push('');
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const grid = classifyDesktopAssets(assets);
  const table = buildDesktopDownloadTable(grid);

  if (!table) {
    lines.push('- 当前未发现安装包附件。');
    return lines;
  }

  lines.push(...table);

  if (grid.other.length > 0) {
    lines.push('');
    lines.push('### 其他产物');
    lines.push('');
    for (const asset of grid.other.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- [${asset.name}](${asset.url})`);
    }
  }

  return lines;
}

function resolveMobileBuildUrl(build) {
  return (
    build?.artifacts?.buildUrl ??
    build?.artifacts?.applicationArchiveUrl ??
    build?.buildDetailsPageUrl ??
    build?.logs?.buildLogsUrl ??
    ''
  );
}

function buildMobileResultLines(buildResults, fallbackMessage) {
  if (!buildResults) {
    return [
      `- ${fallbackMessage || '当前未找到 EAS 构建结果文件，可能是构建失败或未生成可下载产物。'}`,
    ];
  }

  const builds = Array.isArray(buildResults) ? buildResults : [buildResults];
  if (builds.length === 0) {
    return ['- 当前未返回任何 EAS 构建结果。'];
  }

  return builds.map((build) => {
    const platform = String(build?.platform ?? 'unknown');
    const url = resolveMobileBuildUrl(build);

    if (!url) {
      return `- ${platform}: 未返回可公开访问的构建产物链接`;
    }

    return `- ${platform}: ${url}`;
  });
}

function buildResultSection({ target, version, channel, resultLines }) {
  const metadataLines = [`- 发布类型：${targetLabels[target]}`];

  if (version) {
    metadataLines.push(`- 版本：${version}`);
  }

  if (channel) {
    metadataLines.push(`- 发布渠道：${channelLabels[channel]}`);
  }

  return [
    '## 发布结果',
    '',
    ...metadataLines,
    '',
    `## ${resultSectionTitles[target]}`,
    '',
    ...resultLines,
    '',
  ].join('\n');
}

function printCommand(options) {
  const target = normalizeTarget(options['target']?.trim() ?? '');
  const baseFile = options['base-file']?.trim() ?? '';
  const inputFile = options['input-file']?.trim() ?? '';
  const outputFile = options['output-file']?.trim() ?? '';
  const version = normalizeVersion(options['version']?.trim() ?? '');
  const channel = normalizeChannel(options['channel']?.trim() ?? '');
  const fallbackMessage = options['fallback-message']?.trim() ?? '';

  const baseBody = readTextFile(baseFile).trimEnd();
  const inputJson = readOptionalJson(inputFile);
  const resultLines =
    target === 'desktop'
      ? buildDesktopResultLines(inputJson)
      : buildMobileResultLines(inputJson, fallbackMessage);
  const finalBody = `${baseBody}\n\n${buildResultSection({ target, version, channel, resultLines })}`;

  if (outputFile) {
    writeFileSync(outputFile, finalBody, 'utf8');
  }

  process.stdout.write(finalBody);
}

function helpCommand() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/release-result-summary.mjs print --target desktop --base-file release-notes.md --input-file release.json --version desktop-v0.2.0-preview --channel preview --output-file release-summary.md',
      '  node scripts/release-result-summary.mjs print --target mobile --base-file release-notes.md --input-file eas-build-results.json --version 0.2.0 --channel production --fallback-message "当前未配置 EXPO_TOKEN，EAS 构建未执行。" --output-file release-summary.md',
      '',
    ].join('\n'),
  );
}

try {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === 'print') {
    printCommand(options);
  } else {
    helpCommand();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
