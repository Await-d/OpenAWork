/**
 * agentignore 拦截文案回归:保持既有前缀(便于日志/检索口径稳定),
 * 并追加可执行的下一步(常见受保护模式 + 替代做法)。
 */

import { describe, expect, it } from 'vitest';
import {
  formatAgentIgnoreDenial,
  isBashToolOutputPath,
} from '../../workspace/agentignore-denial.js';

describe('formatAgentIgnoreDenial', () => {
  it('保留既有前缀并追加可执行指引', () => {
    const message = formatAgentIgnoreDenial('file', '/repo/.env.production');

    expect(
      message.startsWith(
        'Access denied: file "/repo/.env.production" is protected by agentignore rules',
      ),
    ).toBe(true);
    expect(message).toContain('.env.example');
    expect(message).toContain('请勿重复尝试');
  });

  it('支持 directory 目标', () => {
    const message = formatAgentIgnoreDenial('directory', '/repo/node_modules');
    expect(message).toContain('Access denied: directory "/repo/node_modules"');
  });

  // 回归（2026-10-18 排障）：bash 超限输出的落盘文件若仍被拦，通用文案不解决问题 ——
  // 模型需要被告知改用 read_tool_output，且不要继续用文件工具撞同一路径。
  it('bash 落盘文件命中拦截时改给 read_tool_output 指引', () => {
    const filePath =
      '/home/await/project/OpenAWork/.openAwork/tool-output/bash_1792301799506_mix9n4.txt';
    expect(isBashToolOutputPath(filePath)).toBe(true);

    const message = formatAgentIgnoreDenial('file', filePath);
    expect(message).toContain('Access denied: file');
    expect(message).toContain('read_tool_output');
    expect(message).toContain('toolCallId');
    // 不再套用「改读 .env.example」这类与工具产物无关的通用指引。
    expect(message).not.toContain('.env.example');
  });

  it('Windows 反斜杠路径同样被识别为 bash 落盘文件', () => {
    expect(isBashToolOutputPath('C:\\repo\\.openAwork\\tool-output\\bash_1_ab.txt')).toBe(true);
    expect(isBashToolOutputPath('/repo/.openAwork/tool-output/notes.txt')).toBe(true);
    expect(isBashToolOutputPath('/repo/src/index.ts')).toBe(false);
  });
});
