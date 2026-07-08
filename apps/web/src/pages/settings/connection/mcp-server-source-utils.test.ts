import { describe, expect, it } from 'vitest';
import type { MCPServerEntry } from '@openAwork/shared-ui';
import { resolvePersistableMcpServerSource } from './mcp-server-source-utils.js';

function makeServer(
  server: Partial<Pick<MCPServerEntry, 'builtin' | 'builtinKind' | 'source'>> = {},
): Pick<MCPServerEntry, 'builtin' | 'builtinKind' | 'source'> {
  return {
    builtin: false,
    builtinKind: undefined,
    source: undefined,
    ...server,
  };
}

describe('resolvePersistableMcpServerSource', () => {
  it.each([
    {
      label: '首次修改受保护 builtin 展示行时保留 system',
      current: makeServer({ builtin: true, builtinKind: 'virtual', source: 'builtin' }),
      nextSource: undefined,
      expected: 'system',
    },
    {
      label: '首次修改普通 builtin 展示行时生成 user 覆盖',
      current: makeServer({ builtin: true, builtinKind: 'system', source: 'builtin' }),
      nextSource: undefined,
      expected: 'user',
    },
    {
      label: '已持久化的 system 受保护 builtin 继续保留 system',
      current: makeServer({ builtin: true, builtinKind: 'adapter', source: 'system' }),
      nextSource: 'system',
      expected: 'system',
    },
    {
      label: '旧 user 来源的受保护 builtin 继续保留 user',
      current: makeServer({ builtin: true, builtinKind: 'virtual', source: 'user' }),
      nextSource: 'user',
      expected: 'user',
    },
    {
      label: '普通用户 MCP 默认落到 user',
      current: makeServer(),
      nextSource: undefined,
      expected: 'user',
    },
  ] as const)('$label', ({ current, nextSource, expected }) => {
    expect(resolvePersistableMcpServerSource(current, nextSource)).toBe(expected);
  });
});
