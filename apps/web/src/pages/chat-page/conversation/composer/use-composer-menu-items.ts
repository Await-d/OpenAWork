import { useMemo } from 'react';
import type { CommandDescriptor } from '@openAwork/shared';
import type { ComposerWorkspaceCatalog } from '../../../../hooks/chat/useComposerWorkspaceCatalog.js';
import {
  buildMentionItemsFromSearch,
  type ComposerMenuState,
  type MentionSearchResult,
  type SlashCommandItem,
  type MentionItem,
} from '../../../../components/conversation-runtime/messages/support.js';
import { buildComposerSlashItems } from './composer-slash-items.js';

export interface ComposerMenuItemsDeps {
  composerMenu: ComposerMenuState;
  composerCommandDescriptors: CommandDescriptor[];
  composerWorkspaceCatalog: ComposerWorkspaceCatalog;
  mentionSearch: MentionSearchResult | null | undefined;
}

export interface ComposerMenuItemsReturn {
  slashCommandItems: SlashCommandItem[];
  mentionItems: MentionItem[];
}

export function useComposerMenuItems(deps: ComposerMenuItemsDeps): ComposerMenuItemsReturn {
  const { composerMenu, composerCommandDescriptors, composerWorkspaceCatalog, mentionSearch } =
    deps;

  const slashCommandItems = useMemo<SlashCommandItem[]>(() => {
    const allItems = buildComposerSlashItems({
      agents: composerWorkspaceCatalog.agents,
      commandDescriptors: composerCommandDescriptors,
      installedSkills: composerWorkspaceCatalog.installedSkills,
      agentTools: composerWorkspaceCatalog.agentTools,
      mcpServers: composerWorkspaceCatalog.mcpServers,
    });

    // Add client-side utility commands
    const clientItems: SlashCommandItem[] = [
      {
        id: 'client:templates',
        kind: 'slash',
        source: 'command',
        type: 'action',
        label: '/templates',
        description: '打开提示词模板库',
        badgeLabel: '快捷',
        insertText: '',
        onSelect: async () => {
          window.dispatchEvent(new CustomEvent('openAwork:open-templates'));
        },
      },
      {
        id: 'client:export',
        kind: 'slash',
        source: 'command',
        type: 'action',
        label: '/export',
        description: '导出当前对话',
        badgeLabel: '快捷',
        insertText: '',
        onSelect: async () => {
          window.dispatchEvent(new CustomEvent('openAwork:export-chat'));
        },
      },
      {
        id: 'client:browser',
        kind: 'slash',
        source: 'command',
        type: 'action',
        label: '/browser',
        description: '打开内置浏览器预览',
        badgeLabel: '快捷',
        insertText: '',
        onSelect: async () => {
          window.dispatchEvent(new CustomEvent('openAwork:open-browser'));
        },
      },
    ];

    const combined = [...allItems, ...clientItems];

    if (!composerMenu || composerMenu.type !== 'slash') {
      return [];
    }
    const query = composerMenu.query.toLowerCase();
    return combined.filter((item) =>
      `${item.label} ${item.description} ${item.badgeLabel ?? ''}`.toLowerCase().includes(query),
    );
  }, [composerMenu, composerCommandDescriptors, composerWorkspaceCatalog]);

  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!composerMenu || composerMenu.type !== 'mention') {
      return [];
    }
    return buildMentionItemsFromSearch(mentionSearch);
  }, [composerMenu, mentionSearch]);

  return { slashCommandItems, mentionItems };
}
