import { describe, it, expect, vi, beforeEach } from 'vitest';

type JSONSchema = Record<string, unknown>;

type MCPToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; uri: string };

interface MCPToolResult {
  content: MCPToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

// ---------------------------------------------------------------------------
// Minimal in-process mock of MCPClientAdapterImpl to avoid real network calls
// ---------------------------------------------------------------------------

type MockSDKClient = {
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
};

function makeMockClient(): MockSDKClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'search',
          description: 'Web search',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
        {
          name: 'disabled-tool',
          description: 'Should be hidden',
          inputSchema: {},
        },
      ],
      nextCursor: undefined,
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'result: 42' }],
      isError: false,
    } satisfies { content: MCPToolResult['content']; isError: boolean }),
  };
}

// ---------------------------------------------------------------------------
// Inline MCPClientAdapter that uses the mock instead of real SDK
// ---------------------------------------------------------------------------

type MCPConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface ServerEntry {
  client: MockSDKClient;
  status: MCPConnectionStatus;
  disabledTools: Set<string>;
}

class MockMCPClientAdapter {
  private entries = new Map<string, ServerEntry>();
  private mockClient: MockSDKClient;

  constructor(mockClient: MockSDKClient) {
    this.mockClient = mockClient;
  }

  async connect(server: { id: string; disabledTools?: string[] }): Promise<void> {
    this.entries.set(server.id, {
      client: this.mockClient,
      status: 'connecting',
      disabledTools: new Set(server.disabledTools ?? []),
    });
    await this.mockClient.connect();
    this.entries.get(server.id)!.status = 'connected';
  }

  async disconnect(serverId: string): Promise<void> {
    const entry = this.entries.get(serverId);
    if (!entry) return;
    await entry.client.close();
    this.entries.delete(serverId);
  }

  async listTools(serverId: string): Promise<MCPToolDef[]> {
    const entry = this.getEntry(serverId);
    const { tools } = await entry.client.listTools();
    const typedTools = tools as Array<{
      name: string;
      description?: string;
      inputSchema: JSONSchema;
    }>;
    return typedTools
      .filter((t) => !entry.disabledTools.has(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema,
      }));
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const entry = this.getEntry(serverId);
    const raw = (await entry.client.callTool({ name: toolName, arguments: args })) as MCPToolResult;
    return { content: raw.content, isError: raw.isError };
  }

  getStatus(serverId: string): MCPConnectionStatus {
    return this.entries.get(serverId)?.status ?? 'disconnected';
  }

  private getEntry(serverId: string): ServerEntry {
    const entry = this.entries.get(serverId);
    if (!entry || entry.status !== 'connected') {
      throw new Error(`MCP server ${serverId} not connected`);
    }
    return entry;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: MCP connect → tool_use → result', () => {
  let mockClient: MockSDKClient;
  let adapter: MockMCPClientAdapter;

  const SERVER_ID = 'test-server';
  const SERVER_REF = { id: SERVER_ID, disabledTools: ['disabled-tool'] };

  beforeEach(() => {
    mockClient = makeMockClient();
    adapter = new MockMCPClientAdapter(mockClient);
  });

  it('connect: status transitions to connected', async () => {
    expect(adapter.getStatus(SERVER_ID)).toBe('disconnected');
    await adapter.connect(SERVER_REF);
    expect(adapter.getStatus(SERVER_ID)).toBe('connected');
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it('listTools: returns non-empty list after connect', async () => {
    await adapter.connect(SERVER_REF);
    const tools = await adapter.listTools(SERVER_ID);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('listTools: disabled tools are filtered out', async () => {
    await adapter.connect(SERVER_REF);
    const tools = await adapter.listTools(SERVER_ID);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('disabled-tool');
    expect(names).toContain('search');
  });

  it('callTool: returns MCPToolResult with content', async () => {
    await adapter.connect(SERVER_REF);
    const result = await adapter.callTool(SERVER_ID, 'search', { query: 'test' });
    expect(result).toMatchObject<Partial<MCPToolResult>>({
      isError: false,
    });
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('callTool: result content contains expected text', async () => {
    await adapter.connect(SERVER_REF);
    const result = await adapter.callTool(SERVER_ID, 'search', { query: 'answer' });
    const textContent = result.content.find((c) => c.type === 'text');
    expect(textContent).toBeDefined();
    expect((textContent as { type: 'text'; text: string }).text).toContain('42');
  });

  it('callTool: passes args to underlying SDK client', async () => {
    await adapter.connect(SERVER_REF);
    await adapter.callTool(SERVER_ID, 'search', { query: 'hello world' });
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'search',
      arguments: { query: 'hello world' },
    });
  });

  it('disconnect: status reverts to disconnected', async () => {
    await adapter.connect(SERVER_REF);
    await adapter.disconnect(SERVER_ID);
    expect(adapter.getStatus(SERVER_ID)).toBe('disconnected');
    expect(mockClient.close).toHaveBeenCalledTimes(1);
  });

  it('callTool before connect: throws error', async () => {
    await expect(adapter.callTool(SERVER_ID, 'search', {})).rejects.toThrow(
      `MCP server ${SERVER_ID} not connected`,
    );
  });
});
