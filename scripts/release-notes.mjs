#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const chinesePattern = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const AUTO_EXTRACT_LIMIT = 12;
const USER_FACING_CHANGE_LIMIT = 6;
const USER_FACING_SECTION_TITLE = '本次更新';
const AUTO_EXTRACT_SECTION_TITLE = '自动提取变更';
const IGNORED_USER_FACING_TYPES = new Set(['build', 'chore', 'ci', 'docs', 'style', 'test']);

const scopeLabels = {
  'agent-core': 'Agent 核心',
  artifacts: '产物系统',
  'browser-automation': '浏览器自动化',
  desktop: '桌面端',
  gateway: '网关',
  logger: '日志系统',
  'lsp-client': 'LSP 客户端',
  'mcp-client': 'MCP 客户端',
  mobile: '移动端',
  'multi-agent': '多 Agent',
  pairing: '设备配对',
  'platform-adapter': '平台适配',
  release: '发布流程',
  shared: '共享模块',
  'shared-ui': '共享界面',
  'skill-registry': '技能系统',
  telemetry: '遥测',
  web: 'Web 端',
};

const typeLabels = {
  feat: '新增',
  fix: '修复',
  perf: '优化',
  refactor: '调整',
  revert: '回退',
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

function resolveTargetFamily(target) {
  const normalized = target.trim().toLowerCase();
  if (normalized.startsWith('desktop')) {
    return 'desktop';
  }
  if (normalized.startsWith('mobile')) {
    return 'mobile';
  }
  return 'all';
}

function getLatestReleaseTag(target) {
  const output = runGit('git tag --sort=-version:refname');
  if (!output) {
    return null;
  }

  const targetFamily = resolveTargetFamily(target);

  const tags = output
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => /^(desktop|mobile)-v\d+\.\d+\.\d+(?:-preview)?$/.test(tag))
    .filter((tag) => {
      if (targetFamily === 'all') {
        return true;
      }
      return tag.startsWith(`${targetFamily}-v`);
    });

  return tags[0] ?? null;
}

function getCommitMessagesForReleaseDraft(target) {
  const latestTag = getLatestReleaseTag(target);
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

function parseCommitHeadline(message) {
  const match =
    /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<description>.+)$/i.exec(message);

  if (!match?.groups) {
    return null;
  }

  return {
    type: match.groups.type.toLowerCase(),
    scope: match.groups.scope?.trim().toLowerCase() ?? '',
    description: match.groups.description.trim(),
  };
}

function formatUserFacingChange(message) {
  const parsed = parseCommitHeadline(message);
  if (!parsed) {
    return message.trim();
  }

  if (IGNORED_USER_FACING_TYPES.has(parsed.type)) {
    return null;
  }

  const scopeLabel = parsed.scope ? (scopeLabels[parsed.scope] ?? parsed.scope) : '';
  if (scopeLabel) {
    return `${scopeLabel}：${parsed.description}`;
  }

  const typeLabel = typeLabels[parsed.type] ?? '更新';
  return `${typeLabel}：${parsed.description}`;
}

function buildUserFacingChanges(target) {
  const { messages } = getCommitMessagesForReleaseDraft(target);
  const highlights = [];

  for (const message of messages) {
    const normalized = formatUserFacingChange(message);
    if (!normalized || highlights.includes(normalized)) {
      continue;
    }
    highlights.push(normalized);
    if (highlights.length >= USER_FACING_CHANGE_LIMIT) {
      break;
    }
  }

  if (highlights.length === 0) {
    return [
      `## ${USER_FACING_SECTION_TITLE}`,
      '',
      '- 当前未检测到适合整理为用户更新说明的提交，请在发布前手动补充。',
      '',
    ].join('\n');
  }

  return [
    `## ${USER_FACING_SECTION_TITLE}`,
    '',
    '- 以下内容根据最近的发布提交自动整理，便于快速了解本次变化：',
    ...highlights.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

function formatAutoExtractedChanges(target) {
  const { latestTag, messages, usedFallbackRange } = getCommitMessagesForReleaseDraft(target);
  if (messages.length === 0) {
    return [
      `## ${AUTO_EXTRACT_SECTION_TITLE}`,
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

  return [`## ${AUTO_EXTRACT_SECTION_TITLE}`, '', sourceLine, ...bullets, ''].join('\n');
}

function stripManagedSection(content, title) {
  return content
    .replace(new RegExp(`\n?## ${title}\s*\n[\s\S]*?(?=\n##\s|$)`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function enrichBody(content, target) {
  const cleanedContent = [USER_FACING_SECTION_TITLE, AUTO_EXTRACT_SECTION_TITLE].reduce(
    (current, title) => stripManagedSection(current, title),
    content.trimEnd(),
  );
  const summaryMatch = cleanedContent.match(/^## 更新总结\s*\n+[\s\S]*?(?=\n##\s|$)/m);
  if (!summaryMatch || summaryMatch.index === undefined) {
    throw new Error(
      'Release notes body is missing "## 更新总结" section or lacks content after the heading.',
    );
  }

  const before = cleanedContent.slice(0, summaryMatch.index).trimEnd();
  const summaryBlock = summaryMatch[0].trimEnd();
  const after = cleanedContent.slice(summaryMatch.index + summaryMatch[0].length).trim();

  const sections = [];
  if (before) {
    sections.push(before);
  }
  sections.push(summaryBlock, buildUserFacingChanges(target), formatAutoExtractedChanges(target));
  if (after) {
    sections.push(after);
  }

  return `${sections.join('\n\n').trimEnd()}\n`;
}

function buildNotesBody(version, target, summary) {
  return enrichBody(
    [
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
      '## 安装包',
      '',
      '- 发布完成后由 release workflow 自动补充各平台下载链接。',
      '',
    ].join('\n'),
    target,
  );
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

function enrichCommand(options) {
  const target = (options['target'] ?? '').trim();
  if (!target) {
    throw new Error('Release target is required for enrich command.');
  }

  const content = resolveBodyFromOptions(options);
  const outputFile = (options['output-file'] ?? '').trim();
  const finalBody = enrichBody(content, target);

  if (outputFile) {
    writeFileSync(outputFile, finalBody, 'utf8');
  }

  process.stdout.write(finalBody);
}

function helpCommand() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/release-notes.mjs write --version 0.2.0 --target all-preview --summary "中文总结" --output-file release-notes.md',
      '  node scripts/release-notes.mjs write --version 0.2.0 --target all-preview --summary "中文总结" --dry-run',
      '  node scripts/release-notes.mjs enrich --body-file release-notes.md --target desktop-preview --output-file release-notes.md',
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
  } else if (command === 'enrich') {
    enrichCommand(options);
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
