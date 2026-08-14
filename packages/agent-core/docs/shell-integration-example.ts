/**
 * Shell 工具集成示例
 *
 * 展示如何在 OpenAWork 中集成跨平台 Shell 执行
 */

import {
  executeShellCommand,
  getDefaultShellType,
  getPlatform,
  type ShellType,
} from '@openAwork/agent-core';
import { z } from 'zod';

// Shell 命令输入 Schema
export const shellCommandInputSchema = z.object({
  command: z.string().describe('要执行的 shell 命令'),
  shellType: z
    .enum(['bash', 'powershell'])
    .optional()
    .describe('Shell 类型（可选，默认根据平台自动选择）'),
  timeout: z.number().optional().default(30000).describe('超时时间（毫秒）'),
  cwd: z.string().optional().describe('工作目录'),
});

export type ShellCommandInput = z.infer<typeof shellCommandInputSchema>;

// Shell 命令输出 Schema
export const shellCommandOutputSchema = z.object({
  stdout: z.string().describe('标准输出'),
  stderr: z.string().describe('标准错误输出'),
  exitCode: z.number().nullable().describe('退出码'),
  duration: z.number().describe('执行时长（毫秒）'),
  platform: z.string().describe('执行平台'),
  shellType: z.string().describe('使用的 Shell 类型'),
});

export type ShellCommandOutput = z.infer<typeof shellCommandOutputSchema>;

/**
 * 执行 Shell 命令工具
 */
export async function executeShellCommandTool(
  input: ShellCommandInput,
  signal: AbortSignal,
): Promise<ShellCommandOutput> {
  const startTime = Date.now();
  const platform = getPlatform();

  // 确定使用的 Shell 类型
  const shellType: ShellType = input.shellType ?? getDefaultShellType();

  // 执行命令
  const result = await executeShellCommand(input.command, shellType, {
    timeout: input.timeout,
    cwd: input.cwd,
    signal,
  });

  // 收集输出
  let stdout = '';
  let stderr = '';

  result.process.stdout?.on('data', (data) => {
    stdout += data.toString();
  });

  result.process.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  // 等待进程结束
  const exitCode = await new Promise<number | null>((resolve) => {
    result.process.on('exit', (code) => {
      resolve(code);
    });

    // 处理超时
    const timeoutId = setTimeout(() => {
      if (!result.process.killed) {
        result.process.kill('SIGTERM');
      }
    }, input.timeout);

    result.process.on('exit', () => {
      clearTimeout(timeoutId);
    });
  });

  const duration = Date.now() - startTime;

  return {
    stdout,
    stderr,
    exitCode,
    duration,
    platform,
    shellType,
  };
}

/**
 * 工具定义
 */
export const shellCommandToolDefinition = {
  name: 'execute_shell_command',
  description: '在系统上执行 Shell 命令（支持 Bash 和 PowerShell）',
  inputSchema: shellCommandInputSchema,
  outputSchema: shellCommandOutputSchema,
  execute: executeShellCommandTool,
  timeout: 60000, // 默认 60 秒超时
};

// 使用示例
async function example() {
  const controller = new AbortController();

  // 示例 1: 自动选择平台默认 Shell
  const result1 = await executeShellCommandTool(
    {
      command: 'echo "Hello from OpenAWork"',
    },
    controller.signal,
  );
  console.log('输出:', result1.stdout);

  // 示例 2: 显式使用 Bash
  if (getPlatform() !== 'windows') {
    const result2 = await executeShellCommandTool(
      {
        command: 'ls -la',
        shellType: 'bash',
        timeout: 5000,
      },
      controller.signal,
    );
    console.log('文件列表:', result2.stdout);
  }

  // 示例 3: Windows 上使用 PowerShell
  if (getPlatform() === 'windows') {
    const result3 = await executeShellCommandTool(
      {
        command: 'Get-ChildItem',
        shellType: 'powershell',
        timeout: 5000,
      },
      controller.signal,
    );
    console.log('文件列表:', result3.stdout);
  }
}
