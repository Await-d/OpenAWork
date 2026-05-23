import type { CapabilityDescriptor } from '@openAwork/shared';

export interface CapabilitiesClient {
  list(token: string, sessionId?: string | null): Promise<CapabilityDescriptor[]>;
}

export function createCapabilitiesClient(baseUrl: string): CapabilitiesClient {
  return {
    async list(token: string, sessionId?: string | null): Promise<CapabilityDescriptor[]> {
      const url = new URL(`${baseUrl}/capabilities`);
      if (sessionId) {
        url.searchParams.set('sessionId', sessionId);
      }
      const response = await fetch(url, {
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
