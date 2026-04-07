#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

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

function readRequiredFile(filePath) {
  if (!filePath) {
    throw new Error('缺少文件路径参数。');
  }
  if (!existsSync(filePath)) {
    throw new Error(`文件不存在：${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

function readOptionalFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, 'utf8');
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

function extractPlatformSection(content) {
  const match = content.match(/^## 发布结果\n([\s\S]*)$/m);
  if (!match) {
    return null;
  }

  return match[1]?.trim() ?? null;
}

function buildPlatformBlock(title, content) {
  if (!content) {
    return null;
  }

  const section = extractPlatformSection(content);
  if (!section) {
    return null;
  }

  const normalizedSection = section.replace(/^##\s+/gm, '#### ');

  return [`### ${title}`, '', normalizedSection, ''].join('\n');
}

function composeAggregate({ baseBody, version, desktopContent, mobileContent }) {
  const aggregateLines = ['## 总发布摘要', ''];

  if (version) {
    aggregateLines.push(`- 聚合版本：${version}`, '');
  }

  const desktopBlock = buildPlatformBlock('桌面端发布结果', desktopContent);
  const mobileBlock = buildPlatformBlock('移动端发布结果', mobileContent);

  if (desktopBlock) {
    aggregateLines.push(desktopBlock);
  }

  if (mobileBlock) {
    aggregateLines.push(mobileBlock);
  }

  if (!desktopBlock && !mobileBlock) {
    aggregateLines.push('- 当前未找到可聚合的发布结果。');
  }

  return [baseBody.trimEnd(), '', ...aggregateLines].join('\n');
}

function printCommand(options) {
  const baseFile = options['base-file']?.trim() ?? '';
  const desktopFile = options['desktop-file']?.trim() ?? '';
  const mobileFile = options['mobile-file']?.trim() ?? '';
  const outputFile = options['output-file']?.trim() ?? '';
  const version = normalizeVersion(options['version']?.trim() ?? '');

  const finalBody = composeAggregate({
    baseBody: readRequiredFile(baseFile),
    version,
    desktopContent: readOptionalFile(desktopFile),
    mobileContent: readOptionalFile(mobileFile),
  });

  if (outputFile) {
    writeFileSync(outputFile, finalBody, 'utf8');
  }

  process.stdout.write(finalBody);
}

function helpCommand() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/release-aggregate-summary.mjs print --base-file release-notes.md --desktop-file release-body-final.md --mobile-file mobile-release-summary.md --version 0.2.0 --output-file release-aggregate-summary.md',
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
