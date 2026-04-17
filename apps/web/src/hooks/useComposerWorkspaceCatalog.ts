import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { createCapabilitiesClient } from '@openAwork/web-client';
import type {
  ComposerAgentTool,
  ComposerCapabilityItem,
  InstalledComposerSkill,
} from '../pages/chat-page/support.js';

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

export function useComposerWorkspaceCatalog(enabled: boolean): ComposerWorkspaceCatalog {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [catalog, setCatalog] = useState<ComposerWorkspaceCatalog>(EMPTY_CATALOG);

  useEffect(() => {
    if (!enabled || !accessToken) {
      setCatalog(EMPTY_CATALOG);
      return;
    }

    let cancelled = false;

    void createCapabilitiesClient(gatewayUrl)
      .list(accessToken)
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
  }, [accessToken, enabled, gatewayUrl]);

  return catalog;
}
