import type { CapabilityDescriptor } from '@openAwork/shared';

export interface CapabilitiesClient {
  list(token: string): Promise<CapabilityDescriptor[]>;
}

export function createCapabilitiesClient(baseUrl: string): CapabilitiesClient {
  return {
    async list(token: string): Promise<CapabilityDescriptor[]> {
      const response = await fetch(`${baseUrl}/capabilities`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Failed to load capabilities: ${response.status}`);
      }
      const data = (await response.json()) as { capabilities?: CapabilityDescriptor[] };
      return data.capabilities ?? [];
    },
  };
}
