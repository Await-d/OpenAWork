/**
 * agentignore 拦截文案回归:保持既有前缀(便于日志/检索口径稳定),
 * 并追加可执行的下一步(常见受保护模式 + 替代做法)。
 */

import { describe, expect, it } from 'vitest';
import { formatAgentIgnoreDenial } from '../../workspace/agentignore-denial.js';

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
});
