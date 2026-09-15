import type {
  CanonicalRoleDescriptor,
  CapabilitySource,
  CommandDescriptor,
} from '@openAwork/shared';
import { getRelativePath } from '../../../utils/workspace-path.js';

const BRACKETED_PASTE_START_MARKER = '\u001b[200~';
const BRACKETED_PASTE_END_MARKER = '\u001b[201~';
const HOST_PASTE_PREFIX_PATTERN = /^\s*\[Pasted(?:\s*~\d+)?\]?\s*/iu;

export function sanitizeComposerPlainText(text: string): string {
  if (text.length === 0) {
    return text;
  }

  return text
    .replaceAll(BRACKETED_PASTE_START_MARKER, '')
    .replaceAll(BRACKETED_PASTE_END_MARKER, '')
    .replace(HOST_PASTE_PREFIX_PATTERN, '');
}

export interface WorkspaceFileMentionItem {
  path: string;
  label: string;
  relativePath: string;
}

export interface SlashCommandItem {
  id: string;
  kind: 'slash';
  source: 'agent' | 'command' | 'mcp' | 'skill' | 'tool';
  type: 'action' | 'insert';
  label: string;
  description: string;
  onSelect: () => Promise<void>;
  badgeLabel?: string;
  insertText?: string;
}

export interface InstalledComposerSkill {
  id: string;
  label: string;
  description: string;
  source?: CapabilitySource;
}

export interface ComposerAgentTool {
  name: string;
  description: string;
}

export interface ComposerCapabilityItem {
  id: string;
  kind: 'agent' | 'command' | 'mcp' | 'skill' | 'tool';
  label: string;
  description: string;
  callable?: boolean;
  canonicalRole?: CanonicalRoleDescriptor;
  aliases?: string[];
  source?: CapabilitySource;
}

export interface MentionItem {
  id: string;
  kind: 'mention';
  label: string;
  description: string;
  insertText: string;
}

export type ComposerMenuState =
  | {
      type: 'slash';
      query: string;
      start: number;
      end: number;
      selectedIndex: number;
    }
  | {
      type: 'mention';
      query: string;
      start: number;
      end: number;
      selectedIndex: number;
    }
  | null;

export interface WorkspaceTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: WorkspaceTreeNode[];
}

export function detectComposerTrigger(
  text: string,
  caret: number,
): Omit<NonNullable<ComposerMenuState>, 'selectedIndex'> | null {
  const beforeCaret = text.slice(0, caret);
  const lastBreak = Math.max(beforeCaret.lastIndexOf(' '), beforeCaret.lastIndexOf('\n'));
  const tokenStart = lastBreak + 1;
  const token = beforeCaret.slice(tokenStart);

  if (token.startsWith('/')) {
    return {
      type: 'slash',
      query: token.slice(1),
      start: tokenStart,
      end: caret,
    };
  }

  if (token.startsWith('@')) {
    return {
      type: 'mention',
      query: token.slice(1),
      start: tokenStart,
      end: caret,
    };
  }

  return null;
}

export function flattenWorkspaceFiles(
  nodes: WorkspaceTreeNode[],
  workingDirectory: string,
): WorkspaceFileMentionItem[] {
  const output: WorkspaceFileMentionItem[] = [];

  const visit = (entries: WorkspaceTreeNode[]) => {
    for (const entry of entries) {
      if (entry.type === 'file') {
        const relativePath =
          getRelativePath(entry.path, workingDirectory) === '.'
            ? entry.name
            : (getRelativePath(entry.path, workingDirectory) ?? entry.path);
        output.push({
          path: entry.path,
          label: entry.name,
          relativePath: relativePath || entry.name,
        });
      }
      if (
        entry.type === 'directory' &&
        Array.isArray(entry.children) &&
        entry.children.length > 0
      ) {
        visit(entry.children);
      }
    }
  };

  visit(nodes);
  return output;
}

export function matchServerSlashCommand(
  input: string,
  commands: CommandDescriptor[],
): CommandDescriptor | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [commandToken] = trimmed.split(/\s+/, 1);
  if (!commandToken) return null;

  return (
    commands.find(
      (command) =>
        command.execution === 'server' &&
        command.label.toLowerCase() === commandToken.toLowerCase(),
    ) ?? null
  );
}

export function matchClientSlashCommand(
  input: string,
  commands: CommandDescriptor[],
): CommandDescriptor | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [commandToken] = trimmed.split(/\s+/, 1);
  if (!commandToken) return null;

  return (
    commands.find(
      (command) =>
        command.execution === 'client' &&
        command.label.toLowerCase() === commandToken.toLowerCase(),
    ) ?? null
  );
}
