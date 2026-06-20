/**
 * Post-Write Delta Lint — 文件写入后自动 lint。
 *
 * 参考：hermes-agent v0.13.0
 *   - `write_file` + `patch` 工具执行后自动触发 lint
 *   - 只对修改的文件做增量 lint（delta lint）
 *   - lint 结果反馈给 agent，形成"写→lint→修"闭环
 *
 * 本模块提供 post-write lint hook，供 hash-edit 工具在写入后调用。
 * lint 结果作为 tool_call 的附加输出返回给 agent。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export interface LintResult {
  /** 是否有 lint 错误 */
  hasErrors: boolean;
  /** 是否有 lint 警告 */
  hasWarnings: boolean;
  /** lint 输出文本（截断后） */
  output: string;
  /** 被检查的文件路径 */
  filePath: string;
  /** lint 耗时（ms） */
  durationMs: number;
}

const MAX_LINT_OUTPUT_LENGTH = 2000;

/**
 * 检查项目根目录下是否有 eslint 配置文件。
 */
function findEslintConfig(workspaceRoot: string): string | null {
  const candidates = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    '.eslintrc.js',
    '.eslintrc.mjs',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc',
  ];
  for (const candidate of candidates) {
    const fullPath = path.join(workspaceRoot, candidate);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

/**
 * 对单个文件执行 ESLint，返回结构化结果。
 *
 * 只对修改的文件做增量 lint（`eslint --no-error-on-unmatched-pattern`），
 * 避免全项目扫描的延迟。
 *
 * 如果项目没有 eslint 配置或 eslint 不可用，安静跳过（返回 hasErrors=false）。
 */
export function lintFile(filePath: string, workspaceRoot?: string): Promise<LintResult> {
  const startAt = Date.now();
  const cwd = workspaceRoot ?? path.dirname(filePath);

  // 检查 eslint 配置是否存在
  if (!findEslintConfig(cwd)) {
    return Promise.resolve({
      hasErrors: false,
      hasWarnings: false,
      output: '',
      filePath,
      durationMs: Date.now() - startAt,
    });
  }

  return new Promise<LintResult>((resolve) => {
    const args = [
      'eslint',
      '--no-error-on-unmatched-pattern',
      '--format',
      'compact',
      filePath,
    ];

    // 使用 npx eslint 确保使用项目本地的 eslint
    const child = spawn('npx', args, {
      cwd,
      shell: true,
      timeout: 15_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', () => {
      // eslint 不可用，安静跳过
      resolve({
        hasErrors: false,
        hasWarnings: false,
        output: '',
        filePath,
        durationMs: Date.now() - startAt,
      });
    });

    child.on('close', (code: number) => {
      const rawOutput = (stdout + stderr).trim();
      const output =
        rawOutput.length > MAX_LINT_OUTPUT_LENGTH
          ? `${rawOutput.slice(0, MAX_LINT_OUTPUT_LENGTH)}...[truncated]`
          : rawOutput;

      // eslint exit codes: 0 = no errors, 1 = has errors/warnings, 2 = config error
      const hasErrors = code === 1 && /error/i.test(rawOutput);
      const hasWarnings = code === 1 && /warning/i.test(rawOutput) && !hasErrors;

      resolve({
        hasErrors,
        hasWarnings,
        output,
        filePath,
        durationMs: Date.now() - startAt,
      });
    });
  });
}

/**
 * 批量 lint 多个文件（并行）。
 */
export async function lintFiles(
  filePaths: string[],
  workspaceRoot?: string,
): Promise<LintResult[]> {
  return Promise.all(filePaths.map((fp) => lintFile(fp, workspaceRoot)));
}

/**
 * 将 lint 结果格式化为 agent 可读的反馈文本。
 */
export function formatLintFeedback(results: LintResult[]): string {
  const errorResults = results.filter((r) => r.hasErrors);
  const warningResults = results.filter((r) => r.hasWarnings && !r.hasErrors);
  const cleanResults = results.filter((r) => !r.hasErrors && !r.hasWarnings);

  if (errorResults.length === 0 && warningResults.length === 0) {
    return cleanResults.length > 0
      ? `[post-write-lint] ${cleanResults.length} 个文件 lint 通过 ✓`
      : '';
  }

  const lines: string[] = ['[post-write-lint] 文件写入后 lint 检查结果：'];

  for (const result of errorResults) {
    lines.push(`\n✗ ${result.filePath}（${result.durationMs}ms）:`);
    lines.push(result.output);
  }

  for (const result of warningResults) {
    lines.push(`\n⚠ ${result.filePath}（${result.durationMs}ms）:`);
    lines.push(result.output);
  }

  if (cleanResults.length > 0) {
    lines.push(`\n✓ ${cleanResults.length} 个文件 lint 通过`);
  }

  lines.push('\n请根据上述 lint 结果修复问题后继续。');

  return lines.join('\n');
}
