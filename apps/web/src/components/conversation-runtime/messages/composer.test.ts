/**
 * composer 是聊天输入框的纯逻辑层：粘贴文本清洗、slash / mention 触发识别、
 * 工作区文件树展平，以及 server / client slash 命令匹配。
 * paste 标记常量未导出，这里按其在 `sanitizeComposerPlainText` 中的行为覆盖。
 */
import type { CommandDescriptor } from '@openAwork/shared';
import { describe, expect, it } from 'vitest';
import type { WorkspaceTreeNode } from './composer.js';
import {
  buildMentionItemsFromSearch,
  detectComposerTrigger,
  flattenWorkspaceFiles,
  getMentionDirectoryHint,
  matchClientSlashCommand,
  matchServerSlashCommand,
  sanitizeComposerPlainText,
} from './composer.js';

describe('sanitizeComposerPlainText', () => {
  it('空串原样返回', () => {
    expect(sanitizeComposerPlainText('')).toBe('');
  });

  it('剥离终端 bracketed-paste 控制标记', () => {
    expect(sanitizeComposerPlainText('\u001b[200~hello\u001b[201~')).toBe('hello');
    expect(sanitizeComposerPlainText('a\u001b[200~b')).toBe('ab');
  });

  it('剥离宿主的 [Pasted] / [Pasted ~n] 前缀（大小写不敏感，可带前导空白）', () => {
    expect(sanitizeComposerPlainText('[Pasted] hello')).toBe('hello');
    expect(sanitizeComposerPlainText('[Pasted ~3] hello')).toBe('hello');
    expect(sanitizeComposerPlainText('  [pasted] 前导空白')).toBe('前导空白');
    // 右括号是可选的：宿主异常输出缺 ']' 时同样清理
    expect(sanitizeComposerPlainText('[Pasted ~12 缺右括号')).toBe('缺右括号');
  });

  it('只处理开头的标记，正文中的 [Pasted] 原样保留', () => {
    expect(sanitizeComposerPlainText('say [Pasted] hi')).toBe('say [Pasted] hi');
    expect(sanitizeComposerPlainText('Pasted hello')).toBe('Pasted hello');
    expect(sanitizeComposerPlainText('   ')).toBe('   ');
  });
});

describe('detectComposerTrigger', () => {
  it('无触发符返回 null', () => {
    expect(detectComposerTrigger('', 0)).toBeNull();
    expect(detectComposerTrigger('hello', 5)).toBeNull();
    expect(detectComposerTrigger('a@b', 3)).toBeNull();
  });

  it('识别行首 / 与空格后的 slash 触发', () => {
    expect(detectComposerTrigger('/compact', 8)).toEqual({
      type: 'slash',
      query: 'compact',
      start: 0,
      end: 8,
    });
    expect(detectComposerTrigger('say /comp', 9)).toEqual({
      type: 'slash',
      query: 'comp',
      start: 4,
      end: 9,
    });
  });

  it('识别换行后的 @ mention 触发', () => {
    expect(detectComposerTrigger('a\n@file', 7)).toEqual({
      type: 'mention',
      query: 'file',
      start: 2,
      end: 7,
    });
  });

  it('光标在 token 中间时 query 只取光标前内容', () => {
    expect(detectComposerTrigger('/compact', 4)).toEqual({
      type: 'slash',
      query: 'com',
      start: 0,
      end: 4,
    });
  });

  it('光标越界时 end 原样使用越界值（不 clamp）', () => {
    expect(detectComposerTrigger('/a', 10)).toEqual({
      type: 'slash',
      query: 'a',
      start: 0,
      end: 10,
    });
  });

  it('单独的 / 或 @ 产出空 query', () => {
    expect(detectComposerTrigger('/', 1)).toEqual({ type: 'slash', query: '', start: 0, end: 1 });
    expect(detectComposerTrigger('@', 1)).toEqual({ type: 'mention', query: '', start: 0, end: 1 });
  });
});

describe('flattenWorkspaceFiles', () => {
  const TREE: WorkspaceTreeNode[] = [
    {
      path: '/ws/src',
      name: 'src',
      type: 'directory',
      children: [
        { path: '/ws/src/a.ts', name: 'a.ts', type: 'file' },
        {
          path: '/ws/src/nested',
          name: 'nested',
          type: 'directory',
          children: [{ path: '/ws/src/nested/b.ts', name: 'b.ts', type: 'file' }],
        },
      ],
    },
    { path: '/ws/README.md', name: 'README.md', type: 'file' },
    { path: '/ws/empty', name: 'empty', type: 'directory', children: [] },
  ];

  it('深度优先展开文件并按 workingDirectory 计算相对路径', () => {
    expect(flattenWorkspaceFiles(TREE, '/ws')).toEqual([
      { path: '/ws/src/a.ts', label: 'a.ts', relativePath: 'src/a.ts' },
      { path: '/ws/src/nested/b.ts', label: 'b.ts', relativePath: 'src/nested/b.ts' },
      { path: '/ws/README.md', label: 'README.md', relativePath: 'README.md' },
    ]);
  });

  it('空目录不产出条目；空输入返回空数组', () => {
    expect(flattenWorkspaceFiles([], '/ws')).toEqual([]);
    expect(
      flattenWorkspaceFiles(
        [{ path: '/ws/empty', name: 'empty', type: 'directory', children: [] }],
        '/ws',
      ),
    ).toEqual([]);
  });

  it('工作目录外的文件回退用绝对路径作为 relativePath', () => {
    expect(
      flattenWorkspaceFiles([{ path: '/other/c.ts', name: 'c.ts', type: 'file' }], '/ws'),
    ).toEqual([{ path: '/other/c.ts', label: 'c.ts', relativePath: '/other/c.ts' }]);
  });

  it('Windows 路径同样归一化为 / 分隔的相对路径', () => {
    expect(
      flattenWorkspaceFiles([{ path: 'C:\\ws\\a.ts', name: 'a.ts', type: 'file' }], 'C:\\ws'),
    ).toEqual([{ path: 'C:\\ws\\a.ts', label: 'a.ts', relativePath: 'a.ts' }]);
  });
});

describe('buildMentionItemsFromSearch', () => {
  it('呈现契约：目录行全部排在文件行之前，各自保持服务端返回顺序', () => {
    const items = buildMentionItemsFromSearch({
      directories: ['apps/web', 'src'],
      files: ['README.md', 'src/main.ts'],
    });

    expect(items.map((item) => item.id)).toEqual([
      'dir:apps/web',
      'dir:src',
      'README.md',
      'src/main.ts',
    ]);
    expect(items.slice(0, 2).every((item) => item.isDirectory === true)).toBe(true);
    expect(items.slice(2).every((item) => item.isDirectory === undefined)).toBe(true);
  });

  it('目录条目：dir: id、label 与 insertText 以 / 结尾、description 为父路径', () => {
    const [directoryItem] = buildMentionItemsFromSearch({
      directories: ['apps/web/src'],
      files: [],
    });

    expect(directoryItem).toEqual({
      id: 'dir:apps/web/src',
      kind: 'mention',
      label: 'src/',
      description: 'apps/web',
      insertText: '@apps/web/src/',
      isDirectory: true,
    });
  });

  it('文件条目：id 为相对路径、label 为 basename、insertText 带尾随空格', () => {
    const [fileItem] = buildMentionItemsFromSearch({
      directories: [],
      files: ['apps/web/src/pages/ChatPage.tsx'],
    });

    expect(fileItem).toEqual({
      id: 'apps/web/src/pages/ChatPage.tsx',
      kind: 'mention',
      label: 'ChatPage.tsx',
      description: 'apps/web/src/pages',
      insertText: '@apps/web/src/pages/ChatPage.tsx ',
    });
    expect(fileItem?.isDirectory).toBeUndefined();
  });

  it('根级条目 description 为空串', () => {
    const items = buildMentionItemsFromSearch({ directories: ['src'], files: ['README.md'] });

    expect(items.map((item) => item.description)).toEqual(['', '']);
  });

  it('null / undefined 返回空数组且不抛错', () => {
    expect(buildMentionItemsFromSearch(null)).toEqual([]);
    expect(buildMentionItemsFromSearch(undefined)).toEqual([]);
  });
});

describe('getMentionDirectoryHint', () => {
  it('返回父目录路径，根级条目返回空串', () => {
    expect(getMentionDirectoryHint('README.md')).toBe('');
    expect(getMentionDirectoryHint('apps/web/src/a.ts')).toBe('apps/web/src');
    expect(getMentionDirectoryHint('apps/web/')).toBe('apps');
  });
});

describe('slash 命令匹配', () => {
  const SERVER_COMMAND: CommandDescriptor = {
    id: 'slash-compact',
    label: '/compact',
    description: '压缩当前会话上下文',
    contexts: ['composer'],
    execution: 'server',
    action: { kind: 'compact_session' },
  };

  const CLIENT_COMMAND: CommandDescriptor = {
    id: 'slash-theme',
    label: '/theme',
    description: '切换主题',
    contexts: ['composer'],
    execution: 'client',
    action: { kind: 'toggle_theme' },
  };

  const LABEL_WITHOUT_SLASH: CommandDescriptor = {
    ...SERVER_COMMAND,
    id: 'slash-no-slash',
    label: 'compact',
  };

  it('matchServerSlashCommand 命中 server 命令（大小写不敏感，允许附加参数）', () => {
    expect(matchServerSlashCommand('/compact', [SERVER_COMMAND])?.id).toBe('slash-compact');
    expect(matchServerSlashCommand('/COMPACT now', [SERVER_COMMAND])?.id).toBe('slash-compact');
    expect(matchServerSlashCommand('  /compact', [SERVER_COMMAND])?.id).toBe('slash-compact');
  });

  it('matchServerSlashCommand 对前缀 / 后缀差异不命中', () => {
    expect(matchServerSlashCommand('/comp', [SERVER_COMMAND])).toBeNull();
    expect(matchServerSlashCommand('/compact-extra', [SERVER_COMMAND])).toBeNull();
  });

  it('matchServerSlashCommand 拒绝 client 命令与非 / 开头输入', () => {
    expect(matchServerSlashCommand('/theme', [CLIENT_COMMAND])).toBeNull();
    expect(matchServerSlashCommand('compact', [SERVER_COMMAND])).toBeNull();
    expect(matchServerSlashCommand('', [SERVER_COMMAND])).toBeNull();
    expect(matchServerSlashCommand('   ', [SERVER_COMMAND])).toBeNull();
  });

  it('命令 label 必须自带 /，否则永远无法匹配', () => {
    expect(matchServerSlashCommand('/compact', [LABEL_WITHOUT_SLASH])).toBeNull();
  });

  it('matchClientSlashCommand 命中 client 命令', () => {
    expect(matchClientSlashCommand('/theme', [CLIENT_COMMAND])?.id).toBe('slash-theme');
    expect(matchClientSlashCommand('/THEME', [CLIENT_COMMAND])?.id).toBe('slash-theme');
  });

  it('matchClientSlashCommand 拒绝 server 命令与空命令表', () => {
    expect(matchClientSlashCommand('/compact', [SERVER_COMMAND])).toBeNull();
    expect(matchClientSlashCommand('/theme', [])).toBeNull();
    expect(matchClientSlashCommand('no-slash', [CLIENT_COMMAND])).toBeNull();
  });
});
