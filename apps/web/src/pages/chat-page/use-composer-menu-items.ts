import { useMemo } from 'react';
import type { CommandDescriptor } from '@openAwork/shared';
import type { ComposerWorkspaceCatalog } from '../../hooks/useComposerWorkspaceCatalog.js';
import {
  type ComposerMenuState,
  type SlashCommandItem,
  type MentionItem,
  type WorkspaceFileMentionItem,
} from './support.js';
import { buildComposerSlashItems } from './composer-slash-items.js';

export interface ComposerMenuItemsDeps {
  composerMenu: ComposerMenuState;
  composerCommandDescriptors: CommandDescriptor[];
  composerWorkspaceCatalog: ComposerWorkspaceCatalog;
  workspaceFileItems: WorkspaceFileMentionItem[];
}

export interface ComposerMenuItemsReturn {
  slashCommandItems: SlashCommandItem[];
  mentionItems: MentionItem[];
}

export function useComposerMenuItems(deps: ComposerMenuItemsDeps): ComposerMenuItemsReturn {
  const { composerMenu, composerCommandDescriptors, composerWorkspaceCatalog, workspaceFileItems } =
    deps;

  const slashCommandItems = useMemo<SlashCommandItem[]>(() => {
    const allItems = buildComposerSlashItems({
      agents: composerWorkspaceCatalog.agents,
      commandDescriptors: composerCommandDescriptors,
      installedSkills: composerWorkspaceCatalog.installedSkills,
      agentTools: composerWorkspaceCatalog.agentTools,
      mcpServers: composerWorkspaceCatalog.mcpServers,
    });

    if (!composerMenu || composerMenu.type !== 'slash') {
      return [];
    }
    const query = composerMenu.query.toLowerCase();
    return allItems.filter((item) =>
      `${item.label} ${item.description} ${item.badgeLabel ?? ''}`.toLowerCase().includes(query),
    );
  }, [composerMenu, composerCommandDescriptors, composerWorkspaceCatalog]);

  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!composerMenu || composerMenu.type !== 'mention') {
      return [];
    }
    const query = composerMenu.query.toLowerCase();
    return workspaceFileItems
      .filter((file) => `${file.label} ${file.relativePath}`.toLowerCase().includes(query))
      .slice(0, 8)
      .map((file) => ({
        id: file.path,
        kind: 'mention',
        label: file.label,
        description: file.relativePath,
        insertText: `@${file.relativePath} `,
      }));
  }, [composerMenu, workspaceFileItems]);

  return { slashCommandItems, mentionItems };
}
