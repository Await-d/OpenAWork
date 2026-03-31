#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const chinesePattern = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const AUTO_EXTRACT_LIMIT = 12;

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

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported semver version: ${version}`);
  }
  return version;
}

function runGit(command) {
  try {
    return execSync(command, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

function normalizeSummary(summary) {
  return summary.replace(/\\n/g, '\n').trim();
}

function ensureChineseSummary(summary) {
  if (!summary) {
    throw new Error('Release summary is required.');
  }
  if (!chinesePattern.test(summary)) {
    throw new Error('Release summary must contain Chinese characters.');
  }
}

function extractVersionFromTag(tag) {
  const match = /^(?:desktop|mobile)-v(\d+\.\d+\.\d+)(?:-preview)?$/.exec(tag);
  if (!match) {
    throw new Error(`Unsupported release tag: ${tag}`);
  }
  return parseSemver(match[1]);
}

function getLatestReleaseTag() {
  const output = runGit('git tag --sort=-version:refname');
  if (!output) {
    return null;
  }

  const tags = output
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => /^(desktop|mobile)-v\d+\.\d+\.\d+(?:-preview)?$/.test(tag));

  return tags[0] ?? null;
}

function getCommitMessagesForReleaseDraft() {
  const latestTag = getLatestReleaseTag();
  const range = latestTag ? `${latestTag}..HEAD` : 'HEAD';
  const output = runGit(`git log --format=%s%x1f ${range}`);
  if (!output) {
    return {
      latestTag,
      messages: [],
      usedFallbackRange: false,
    };
  }

  const allMessages = output
    .split('\x1f')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => !entry.startsWith('Merge '))
    .filter((entry) => !/^build\(release\):\s*自动提升版本到 v/i.test(entry));

  if (latestTag) {
    return {
      latestTag,
      messages: allMessages.slice(0, AUTO_EXTRACT_LIMIT),
      usedFallbackRange: false,
    };
  }

  return {
    latestTag: null,
    messages: allMessages.slice(0, AUTO_EXTRACT_LIMIT),
    usedFallbackRange: true,
  };
}

function formatAutoExtractedChanges() {
  const { latestTag, messages, usedFallbackRange } = getCommitMessagesForReleaseDraft();
  if (messages.length === 0) {
    return [
      '## 自动提取变更',
      '',
      '- 未检测到可用于生成发布稿的提交摘要，请在发布前手动补充。',
      '',
    ].join('\n');
  }

  const bullets = messages.map((message) => `- ${message}`);
  const sourceLine = latestTag
    ? `- 提取范围：${latestTag}..HEAD`
    : usedFallbackRange
      ? `- 提取范围：最近 ${messages.length} 条可用提交（当前尚无 release tag）`
      : '- 提取范围：当前提交历史';

  return ['## 自动提取变更', '', sourceLine, ...bullets, ''].join('\n');
}

function buildNotesBody(version, target, summary) {
  const autoExtractedChanges = formatAutoExtractedChanges();

  return [
    `# v${version} 发布日志`,
    '',
    `- 版本：v${version}`,
    `- 发布目标：${target}`,
    '- 语言：中文',
    '- 来源：GitHub Release Workflow',
    '',
    '## 更新总结',
    '',
    summary,
    '',
    autoExtractedChanges,
    '## 安装包',
    '',
    '- 发布完成后由 release workflow 自动补充各平台下载链接。',
    '',
  ].join('\n');
}

function extractSummary(content) {
  const summaryMatch = content.match(/^## 更新总结\s*\n+([\s\S]*?)(?:\n##\s|$)/m);
  if (!summaryMatch) {
    throw new Error(
      'Release notes body is missing "## 更新总结" section or lacks content after the heading.',
    );
  }

  const summarySection = summaryMatch[1] ?? '';
  const summaryLine =
    summarySection
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? '';

  ensureChineseSummary(summaryLine);

  return summaryLine;
}

function resolveBodyFromOptions(options) {
  const bodyFile = options['body-file']?.trim() ?? '';
  const body = options['body']?.trim() ?? '';
  const tag = options['tag']?.trim() ?? '';

  if (bodyFile) {
    if (!existsSync(bodyFile)) {
      throw new Error(`Release notes body file not found: ${bodyFile}`);
    }
    return readFileSync(bodyFile, 'utf8');
  }

  if (body) {
    return body;
  }

  if (tag) {
    const content = runGit(`git tag -l --format=%(contents) "${tag}"`);
    if (!content) {
      throw new Error(`Release notes tag annotation not found for tag: ${tag}`);
    }
    return content;
  }

  throw new Error('Either --body-file, --body, or --tag is required.');
}

function writeCommand(options) {
  const version = parseSemver(options['version'] ?? '');
  const target = (options['target'] ?? '').trim();
  const summary = normalizeSummary(options['summary'] ?? '');
  const outputFile = (options['output-file'] ?? '').trim();
  const dryRun = options['dry-run'] === 'true' || options['dry-run'] === '';

  if (!target) {
    throw new Error('Release target is required.');
  }
  ensureChineseSummary(summary);

  const content = buildNotesBody(version, target, summary);

  if (outputFile && !dryRun) {
    writeFileSync(outputFile, content, 'utf8');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        outputFile: outputFile || null,
        dryRun,
        summaryLine: summary,
        body: content,
      },
      null,
      2,
    )}\n`,
  );
}

function inspectCommand(options) {
  const content = resolveBodyFromOptions(options);
  const tag = options['tag']?.trim() ?? '';
  const version = tag ? extractVersionFromTag(tag) : (options['version']?.trim() ?? null);
  const summaryLine = extractSummary(content);

  process.stdout.write(
    `${JSON.stringify(
      {
        version,
        summaryLine,
      },
      null,
      2,
    )}\n`,
  );
}

function printCommand(options) {
  const hasGenerateArgs = Boolean(options['version'] && options['target'] && options['summary']);
  if (hasGenerateArgs) {
    const version = parseSemver(options['version']);
    const target = (options['target'] ?? '').trim();
    const summary = normalizeSummary(options['summary'] ?? '');
    ensureChineseSummary(summary);
    process.stdout.write(buildNotesBody(version, target, summary));
    return;
  }

  process.stdout.write(resolveBodyFromOptions(options));
}

function helpCommand() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/release-notes.mjs write --version 0.2.0 --target all-preview --summary "中文总结" --output-file release-notes.md',
      '  node scripts/release-notes.mjs write --version 0.2.0 --target all-preview --summary "中文总结" --dry-run',
      '  node scripts/release-notes.mjs inspect --tag desktop-v0.2.0-preview',
      '  node scripts/release-notes.mjs inspect --body-file release-notes.md',
      '  node scripts/release-notes.mjs print --version 0.2.0 --target all-preview --summary "中文总结"',
      '',
    ].join('\n'),
  );
}

try {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === 'write') {
    writeCommand(options);
  } else if (command === 'inspect') {
    inspectCommand(options);
  } else if (command === 'print') {
    printCommand(options);
  } else {
    helpCommand();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
