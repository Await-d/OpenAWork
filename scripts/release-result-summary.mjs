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

function buildDesktopResultLines(release) {
  if (!release) {
    return ['- 当前未找到 GitHub Release 资产信息。'];
  }

  const lines = [];
  if (typeof release.html_url === 'string' && release.html_url.length > 0) {
    lines.push(`- GitHub Release：${release.html_url}`);
  }

  const assets = Array.isArray(release.assets)
    ? release.assets
        .filter((asset) => {
          const name = String(asset?.name ?? '');
          const url = String(asset?.browser_download_url ?? '');
          return Boolean(name) && Boolean(url) && !name.endsWith('.sig') && !name.endsWith('.json');
        })
        .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    : [];

  if (assets.length === 0) {
    lines.push('- 当前未发现安装包附件。');
    return lines;
  }

  for (const asset of assets) {
    lines.push(`- [${String(asset.name)}](${String(asset.browser_download_url)})`);
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

function buildMobileResultLines(buildResults) {
  if (!buildResults) {
    return ['- 当前未找到 EAS 构建结果文件，可能是构建失败或未生成可下载产物。'];
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

  const baseBody = readTextFile(baseFile).trimEnd();
  const inputJson = readOptionalJson(inputFile);
  const resultLines =
    target === 'desktop' ? buildDesktopResultLines(inputJson) : buildMobileResultLines(inputJson);
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
      '  node scripts/release-result-summary.mjs print --target mobile --base-file release-notes.md --input-file eas-build-results.json --version 0.2.0 --channel production --output-file release-summary.md',
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
