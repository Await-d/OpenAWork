import { describe, expect, it } from 'vitest';

import {
  getVirtualMcpProvider,
  listVirtualMcpProviders,
} from '../../mcp/virtual-mcp-provider-registry.js';

describe('VirtualMcpProviderRegistry', () => {
  it('Given multiple virtual providers When querying by id Then returns only the matching provider without cross-contamination', () => {
    const providers = listVirtualMcpProviders();
    const providerIds = providers.map((provider) => provider.id);
    const resolvedProviders = providers.map((provider) => getVirtualMcpProvider(provider.id));

    expect(providerIds).toEqual(['open_websearch', 'codegraph', 'git_bash', 'lsp', 'omo']);
    expect(new Set(providerIds).size).toBe(providerIds.length);
    expect(resolvedProviders).toEqual(providers);
    expect(getVirtualMcpProvider('missing')).toBeUndefined();
  });
});
