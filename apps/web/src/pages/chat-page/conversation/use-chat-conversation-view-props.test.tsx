// @vitest-environment jsdom
/**
 * P1 组装层瘦身 —— props 单一来源的契约护栏。
 *
 * 背景：P1 把 ChatPage 里 fusion / classic 两分支各自近 220 / 234 行的
 * `<ChatConversationView>` prop 列表，收敛为「一个 `useChatConversationViewProps`
 * 产出、两个区域容器消费」。本文件守住这条不变量：
 *
 *  1. hook 的默认值与透传行为不变（`sessionSource='chat'`、chat 端全开的
 *     `composerExtras`；传入的公共 props / chrome 原样返回）。
 *  2. **ChatPage 不再直接渲染 `<ChatConversationView>`**，两分支各由一个区域容器承载；
 *     两个区域容器各只渲染一个 `<ChatConversationView>`，`compact` 取向相反。
 *
 * 说明（诚实边界）：
 * - 「prop 被丢弃 / 改名」的编译期契约由类型系统保证
 *   （`ChatConversationViewCommonProps = Omit<ChatConversationViewProps, 'topBar' | 'compact'>`），
 *   并在 `tsc --noEmit` 门禁下强制——不在此重复。
 * - 「两分支实际渲染是否等价」由 P0 的 `ChatPage.test.tsx`（classic↔fusion 切换）
 *   与 `ChatConversationView.test.tsx`（逐 prop 可观测产物）覆盖。
 * - 本文件只对 hook 行为与源码结构做确定性断言，不渲染真实视图。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  useChatConversationViewProps,
  type ChatConversationViewPropsInput,
} from './use-chat-conversation-view-props.js';

/**
 * 测试替身输入：本文件不渲染真实视图，只需一个可透传的对象。
 * 集中在这里做一次显式断言，避免堆 110 个必填 prop / 散落类型逃逸。
 */
function inputOf(partial: Record<string, unknown>): ChatConversationViewPropsInput {
  return partial as unknown as ChatConversationViewPropsInput;
}

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

/** 剥掉块注释与行注释，避免文档里出现的标签字面量污染结构断言。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('useChatConversationViewProps', () => {
  it('缺省时填充 sessionSource="chat" 与 chat 端全开的 composerExtras', () => {
    const model = useChatConversationViewProps(inputOf({}));

    expect(model.sessionSource).toBe('chat');
    expect(model.composerExtras).toEqual({
      imageGeneration: true,
      skillRecommendation: true,
      multiSelect: true,
      bookmarks: true,
      promptTemplate: true,
      commandPalette: true,
      dialogueModeToggle: true,
      permissionMode: true,
      agentSwitch: true,
    });
  });

  it('原样透传公共 props 与 chrome（同引用，不复制不改写）', () => {
    const chrome = { marker: 'chrome-identity' };
    const messages = [{ id: 'm1' }];
    const model = useChatConversationViewProps(
      inputOf({ chrome, messages, sessionId: 'session-x' }),
    );

    expect(model.chrome).toBe(chrome);
    expect(model.messages).toBe(messages);
    expect(model.sessionId).toBe('session-x');
  });

  it('显式传入的 composerExtras 优先于缺省值', () => {
    const composerExtras = { ...inputOf({}).composerExtras, bookmarks: false };
    const model = useChatConversationViewProps(inputOf({ composerExtras }));

    expect(model.composerExtras?.bookmarks).toBe(false);
  });
});

describe('ChatPage 组装层去重不变量（P1）', () => {
  it('ChatPage.tsx 不再直接渲染 <ChatConversationView>，改由两个区域容器承载', () => {
    const chatPage = stripComments(readSource('../ChatPage.tsx'));

    expect(chatPage).not.toMatch(/<ChatConversationView\b/);
    expect(chatPage).toContain('<FusionChatRegion model={conversationViewModel} />');
    expect(chatPage).toContain('<ClassicChatRegion model={conversationViewModel} />');
    // 公共 props 只组装一次
    expect(chatPage.match(/useChatConversationViewProps\(/g)).toHaveLength(1);
  });

  it('两个区域容器各只渲染一个 <ChatConversationView>，且 compact 取向相反', () => {
    const fusion = stripComments(readSource('../layout/FusionChatRegion.tsx'));
    const classic = stripComments(readSource('../layout/ClassicChatRegion.tsx'));

    expect(fusion.match(/<ChatConversationView\b/g)).toHaveLength(1);
    expect(classic.match(/<ChatConversationView\b/g)).toHaveLength(1);
    expect(fusion).toMatch(/^\s*compact$/m);
    expect(classic).toContain('compact={false}');
    expect(classic).not.toMatch(/^\s*compact$/m);
  });
});
