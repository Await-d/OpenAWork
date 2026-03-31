import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGetMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGetMock,
}));

vi.mock('../tool-definitions.js', () => ({
  buildGatewayToolDefinitions: () => [
    { function: { name: 'read', description: 'read tool', parameters: { type: 'object' } } },
    { function: { name: 'task', description: 'task tool', parameters: { type: 'object' } } },
    {
      function: { name: 'question', description: 'question tool', parameters: { type: 'object' } },
    },
  ],
}));

vi.mock('../session-tool-visibility.js', () => ({
  filterEnabledGatewayToolsForSession: (tools: Array<{ function: { name: string } }>) =>
    tools.filter((tool) => tool.function.name === 'read'),
}));

vi.mock('../agent-catalog.js', () => ({
  listEnabledAgentCapabilitiesForUser: () => [],
}));

vi.mock('@openAwork/skills', () => ({
  BUILTIN_SKILLS: [],
}));

import { buildCapabilityContext } from '../routes/capabilities.js';

describe('buildCapabilityContext', () => {
  it('uses session-level visible tools when sessionId is provided', () => {
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes("key = 'mcp_servers'")) {
        return { value: '[]' };
      }
      if (query.includes('installed_skills')) {
        return { value: '[]' };
      }
      if (query.includes('FROM sessions WHERE id = ? AND user_id = ? LIMIT 1')) {
        return { metadata_json: JSON.stringify({ createdByTool: 'task', parentSessionId: 'p-1' }) };
      }
      return undefined;
    });

    const context = buildCapabilityContext('user-1', 'session-1');
    expect(context).toContain('聊天可调用工具');
    expect(context).toContain('- read: read tool');
    expect(context).not.toContain('- task: task tool');
    expect(context).not.toContain('- question: question tool');
  });
});
