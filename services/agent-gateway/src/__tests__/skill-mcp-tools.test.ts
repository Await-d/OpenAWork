import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  connectMock: vi.fn(async () => undefined),
  disconnectMock: vi.fn(async () => undefined),
  callToolMock: vi.fn(async () => ({ ok: true, kind: 'tool' })),
  readResourceMock: vi.fn(async () => ({ contents: [{ uri: 'memory://note', text: 'hello' }] })),
  getPromptMock: vi.fn(async () => ({ messages: [{ role: 'user', content: 'prompt' }] })),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocked.sqliteAllMock,
}));

vi.mock('@openAwork/mcp-client', () => ({
  MCPClientAdapterImpl: class {
    connect = mocked.connectMock;
    disconnect = mocked.disconnectMock;
    callTool = mocked.callToolMock;
    readResource = mocked.readResourceMock;
    getPrompt = mocked.getPromptMock;
  },
}));

import { runSkillMcpTool } from '../skill-mcp-tools.js';

describe('skill-mcp-tools', () => {
  it('calls tool/resource/prompt operations for installed skill MCPs', async () => {
    mocked.sqliteAllMock.mockReturnValue([
      {
        skill_id: 'skill-1',
        manifest_json: JSON.stringify({
          id: 'skill-1',
          name: 'skill-one',
          displayName: 'Skill One',
          mcp: { id: 'memory', transport: 'sse', url: 'https://example.com/mcp' },
        }),
      },
    ]);

    const toolOutput = await runSkillMcpTool('user-1', {
      mcp_name: 'memory',
      tool_name: 'query',
      arguments: { q: 'x' },
    });
    expect(toolOutput).toContain('"kind": "tool"');

    const resourceOutput = await runSkillMcpTool('user-1', {
      mcp_name: 'memory',
      resource_name: 'memory://note',
    });
    expect(resourceOutput).toContain('memory://note');

    const promptOutput = await runSkillMcpTool('user-1', {
      mcp_name: 'memory',
      prompt_name: 'summarize',
      arguments: { topic: 'abc' },
    });
    expect(promptOutput).toContain('prompt');
    expect(mocked.connectMock).toHaveBeenCalled();
    expect(mocked.disconnectMock).toHaveBeenCalled();
  });
});
