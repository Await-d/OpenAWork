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
  /** 目录条目（@ 菜单目录钻取）；文件条目不带此字段。 */
  isDirectory?: boolean;
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

export interface MentionSearchResult {
  files: readonly string[];
  directories: readonly string[];
}

/**
 * `@` 文件提及检索的显式结果上限。服务端默认同为 20，这里显式传入，
 * 让菜单最多展示多少条成为前端约定，而不是隐式跟随服务端默认值。
 */
export const MENTION_SEARCH_LIMIT = 20;

function getMentionBasename(relativePath: string): string {
  const lastSlash = relativePath.lastIndexOf('/');
  return lastSlash === -1 ? relativePath : relativePath.slice(lastSlash + 1);
}

export function getMentionDirectoryHint(relativePath: string): string {
  const normalized = relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath;
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
}

export function buildMentionItemsFromSearch(
  result: MentionSearchResult | null | undefined,
): MentionItem[] {
  if (!result) {
    return [];
  }

  const directoryItems: MentionItem[] = result.directories.map((directory) => ({
    id: `dir:${directory}`,
    kind: 'mention',
    label: `${getMentionBasename(directory)}/`,
    description: getMentionDirectoryHint(directory),
    insertText: `@${directory}/`,
    isDirectory: true,
  }));

  const fileItems: MentionItem[] = result.files.map((file) => ({
    id: file,
    kind: 'mention',
    label: getMentionBasename(file),
    description: getMentionDirectoryHint(file),
    insertText: `@${file} `,
  }));

  // 呈现契约：目录行始终排在文件行之前；目录与文件各自保持服务端返回的顺序
  // （搜索模式下服务端已按相关度排好，文件在分数相同时优先，但那只是数组内部顺序）。
  return [...directoryItems, ...fileItems];
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
