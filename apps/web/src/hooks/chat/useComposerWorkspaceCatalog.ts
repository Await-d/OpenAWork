import { useEffect, useState } from 'react';
import { createCapabilitiesClient } from '@openAwork/web-client';
import type {
  ComposerAgentTool,
  ComposerCapabilityItem,
  InstalledComposerSkill,
} from '../../components/conversation-runtime/messages/support.js';

export interface ComposerWorkspaceCatalog {
  agents: ComposerCapabilityItem[];
  agentTools: ComposerAgentTool[];
  installedSkills: InstalledComposerSkill[];
  mcpServers: ComposerCapabilityItem[];
}

const EMPTY_CATALOG: ComposerWorkspaceCatalog = {
  agents: [],
  agentTools: [],
  installedSkills: [],
  mcpServers: [],
};

export function useComposerWorkspaceCatalog(input: {
  enabled: boolean;
  gatewayUrl: string;
  sessionId: string | null;
  token: string | null;
}): ComposerWorkspaceCatalog {
  const { enabled, gatewayUrl, sessionId, token } = input;
  const [catalog, setCatalog] = useState<ComposerWorkspaceCatalog>(EMPTY_CATALOG);

  useEffect(() => {
    if (!enabled || !token) {
      setCatalog(EMPTY_CATALOG);
      return;
    }

    let cancelled = false;

    void createCapabilitiesClient(gatewayUrl)
      .list(token, sessionId)
      .then((capabilities) => {
        if (cancelled) return;

        const installedSkills = capabilities
          .filter((capability) => capability.kind === 'skill')
          .map<InstalledComposerSkill>((capability) => ({
            id: capability.id,
            label: capability.label,
            description: capability.description,
            source: capability.source,
          }))
          .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));

        const agentTools = capabilities
          .filter(
            (capability) =>
              capability.kind === 'tool' &&
              capability.callable === true &&
              !capability.label.startsWith('lsp_'),
          )
          .map<ComposerAgentTool>((capability) => ({
            name: capability.label,
            description: capability.description,
          }))
          .sort((left, right) => left.name.localeCompare(right.name, 'en-US'));

        const agents = capabilities
          .filter((capability) => capability.kind === 'agent')
          .map<ComposerCapabilityItem>((capability) => ({
            id: capability.id,
            kind: 'agent',
            label: capability.label,
            description: capability.description,
            callable: capability.callable,
            canonicalRole: capability.canonicalRole,
            aliases: capability.aliases,
            source: capability.source,
          }))
          .sort((left, right) => left.label.localeCompare(right.label, 'en-US'));

        const mcpServers = capabilities
          .filter((capability) => capability.kind === 'mcp')
          .map<ComposerCapabilityItem>((capability) => ({
            id: capability.id,
            kind: 'mcp',
            label: capability.label,
            description: capability.description,
            callable: capability.callable,
            canonicalRole: capability.canonicalRole,
            aliases: capability.aliases,
            source: capability.source,
          }))
          .sort((left, right) => left.label.localeCompare(right.label, 'en-US'));

        setCatalog({ installedSkills, agentTools, agents, mcpServers });
      })
      .catch(() => {
        if (!cancelled) {
          setCatalog(EMPTY_CATALOG);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, gatewayUrl, sessionId, token]);

  return catalog;
}
