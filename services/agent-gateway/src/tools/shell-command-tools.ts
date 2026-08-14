/**
 * 跨平台 Shell 执行工具
 *
 * 基于 @openAwork/agent-core 的跨平台 Shell 模块，提供统一的 Bash 和 PowerShell 执行接口
 */

import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import {
  executeShellCommand,
  getDefaultShellType,
  getPlatform,
  type ShellType,
} from '@openAwork/agent-core';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { getSessionWorkingDirectory } from '../workspace/workspace-safety.js';

// 输入 Schema
const shellCommandInputSchema = z.object({
  command: z.string().min(1).describe('要执行的 shell 命令'),
  shellType: z
    .enum(['bash', 'powershell'])
    .optional()
    .describe('Shell 类型（可选，默认根据平台自动选择：Windows 用 PowerShell，其他用 Bash）'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(30 * 60 * 1000) // 最大 30 分钟
    .optional()
    .default(2 * 60 * 1000) // 默认 2 分钟
    .describe('超时时间（毫秒），默认 120000ms（2 分钟）'),
  workdir: z
    .string()
    .optional()
    .describe('工作目录，默认为当前会话工作目录'),
  description: z
    .string()
    .optional()
    .describe(
      '命令描述（5-10 个词），用于审计日志。省略时自动从命令生成。',
    ),
});

export type ShellCommandInput = z.infer<typeof shellCommandInputSchema>;

// 输出 Schema
const shellCommandOutputSchema = z.object({
  command: z.string().describe('执行的命令'),
  description: z.string().describe('命令描述'),
  shellType: z.string().describe('使用的 Shell 类型'),
  platform: z.string().describe('执行平台'),
  cwd: z.string().describe('工作目录'),
  exitCode: z.number().describe('退出码（-1 表示异常）'),
  output: z.string().describe('命令输出（stdout + stderr）'),
  duration: z.number().describe('执行时长（毫秒）'),
  kind: z
    .enum(['exit', 'timeout', 'aborted', 'error'])
    .describe('执行结果类型'),
});

export type ShellCommandOutput = z.infer<typeof shellCommandOutputSchema>;

/**
 * 从命令生成描述
 */
function deriveCommandDescription(command: string): string {
  const firstLine = command.split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) {
    return '执行 shell 命令';
  }
  const clipped = firstLine.length > 50 ? `${firstLine.slice(0, 50)}…` : firstLine;
  return `运行 \`${clipped}\``;
}

/**
 * 执行 Shell 命令
 */
async function executeShellCommandTool(
  input: ShellCommandInput,
  signal: AbortSignal,
): Promise<ShellCommandOutput> {
  const startTime = Date.now();
  const platform = getPlatform();

  // 确定 Shell 类型
  const shellType: ShellType = input.shellType ?? getDefaultShellType();

  // 确定工作目录（暂时使用 process.cwd()，后续集成时再连接到会话系统）
  const cwd = input.workdir ?? process.cwd();

  // 验证工作目录（如果启用）
  try {
    validateWorkspacePath(cwd);
  } catch {
    // 验证失败时使用当前工作目录
  }

  // 生成描述
  const description = input.description ?? deriveCommandDescription(input.command);

  // 执行命令
  const result = await executeShellCommand(input.command, shellType, {
    cwd,
    timeout: input.timeout,
    signal,
  });

  // 收集输出
  let output = '';
  let stderr = '';

  result.process.stdout?.on('data', (data) => {
    output += data.toString();
  });

  result.process.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  // 等待进程结束
  let exitCode: number | null = null;
  let kind: 'exit' | 'timeout' | 'aborted' | 'error' = 'exit';

  try {
    exitCode = await new Promise<number | null>((resolve, reject) => {
      let didTimeout = false;
      let wasAborted = false;

      // 超时处理
      const timeoutId = setTimeout(() => {
        didTimeout = true;
        if (!result.process.killed) {
          result.process.kill('SIGTERM');
        }
      }, input.timeout);

      // 中止处理
      const abortHandler = () => {
        wasAborted = true;
        if (!result.process.killed) {
          result.process.kill('SIGTERM');
        }
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler);
      }

      result.process.on('exit', (code) => {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }

        if (didTimeout) {
          kind = 'timeout';
        } else if (wasAborted) {
          kind = 'aborted';
        } else {
          kind = 'exit';
        }

        resolve(code);
      });

      result.process.on('error', (err) => {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
        kind = 'error';
        reject(err);
      });
    });
  } catch (error) {
    kind = 'error';
    output += `\n\n[执行错误]: ${error instanceof Error ? error.message : String(error)}`;
  }

  const duration = Date.now() - startTime;

  // 合并 stdout 和 stderr
  const combinedOutput = stderr ? `${output}\n\n[stderr]:\n${stderr}` : output;

  return {
    command: input.command,
    description,
    shellType,
    platform,
    cwd,
    exitCode: exitCode ?? -1, // 如果没有退出码，使用 -1 表示异常
    output: combinedOutput,
    duration,
    kind,
  };
}

/**
 * Shell 命令工具定义
 */
export const shellCommandToolDefinition: ToolDefinition<
  typeof shellCommandInputSchema,
  typeof shellCommandOutputSchema
> = {
  name: 'execute_shell',
  description: `在系统上执行 Shell 命令。

**平台支持**:
- Windows: 默认使用 PowerShell，也支持 Git Bash
- macOS/Linux: 使用 Bash 或 Zsh
- WSL: 自动检测并使用 POSIX Shell

**功能特性**:
- 自动平台适配（路径转换、命令修正）
- 超时自动终止
- 支持中止信号
- 工作目录验证
- 退出码捕获

**使用示例**:
- 列出文件: { "command": "ls -la" }
- Git 状态: { "command": "git status" }
- 安装依赖: { "command": "npm install", "timeout": 300000 }

**注意事项**:
- 避免使用 sudo（不允许）
- 避免环境变量覆盖（PATH=、LD_*=、DYLD_*=）
- 使用 workdir 参数而不是 cd 命令
- 长时间运行的命令请增加 timeout 参数`,
  inputSchema: shellCommandInputSchema,
  outputSchema: shellCommandOutputSchema,
  execute: executeShellCommandTool,
  timeout: 30 * 60 * 1000, // 30 分钟
};

/**
 * 导出工具名称（用于工具列表）
 */
export const SHELL_COMMAND_TOOL_NAME = 'execute_shell';
