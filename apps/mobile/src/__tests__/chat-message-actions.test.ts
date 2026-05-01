import { describe, expect, it } from 'vitest';
import {
  findChatMessageMatches,
  findPreviousUserMessage,
  getChatRestoreFocusLabel,
  buildChatDraftSummary,
  insertMobilePromptTemplate,
  isNearChatBottom,
  MOBILE_PROMPT_TEMPLATES,
  moveChatSearchCursor,
  parseMobileMessageSegments,
  summarizeMobileCodeBlock,
  toInputImageParts,
} from '../screens/chat-message-actions.js';

describe('mobile chat message actions', () => {
  it('converts persisted input images to stream input parts', () => {
    expect(
      toInputImageParts({
        inputImages: [
          { artifactId: 'artifact-1', fileName: 'draft.png', mimeType: 'image/png' },
          { fileName: 'local-only.png', imageUrl: 'file:///tmp/local-only.png' },
        ],
      }),
    ).toEqual([
      {
        type: 'input_image',
        artifactId: 'artifact-1',
        fileName: 'draft.png',
        mimeType: 'image/png',
      },
    ]);
  });

  it('finds the nearest previous user message for assistant regeneration', () => {
    const previous = findPreviousUserMessage(
      [
        { id: 'u-1', role: 'user' as const },
        { id: 'a-1', role: 'assistant' as const },
        { id: 'u-2', role: 'user' as const },
        { id: 'a-2', role: 'assistant' as const },
      ],
      'a-2',
    );

    expect(previous?.id).toBe('u-2');
  });

  it('finds case-insensitive message matches across text and image labels', () => {
    expect(
      findChatMessageMatches(
        [
          { id: 'm-1', content: 'Hello mobile chat', inputImages: [] },
          {
            id: 'm-2',
            content: 'No text hit',
            inputImages: [{ artifactId: 'artifact-2', fileName: 'Wireframe.PNG' }],
          },
        ],
        'png',
      ),
    ).toEqual([{ index: 1, messageId: 'm-2', preview: 'No text hit Wireframe.PNG' }]);
  });

  it('wraps search cursor navigation', () => {
    expect(moveChatSearchCursor(-1, 3, 'next')).toBe(0);
    expect(moveChatSearchCursor(2, 3, 'next')).toBe(0);
    expect(moveChatSearchCursor(0, 3, 'previous')).toBe(2);
    expect(moveChatSearchCursor(0, 0, 'next')).toBe(-1);
  });

  it('detects whether the chat list is near the bottom', () => {
    expect(isNearChatBottom({ contentHeight: 1200, offsetY: 540, viewportHeight: 600 })).toBe(true);
    expect(isNearChatBottom({ contentHeight: 1200, offsetY: 400, viewportHeight: 600 })).toBe(
      false,
    );
  });

  it('labels restore focus button based on streaming state', () => {
    expect(getChatRestoreFocusLabel(false)).toBe('定位最新对话');
    expect(getChatRestoreFocusLabel(true)).toBe('有新内容 · 恢复聚焦');
  });

  it('summarizes composer draft metadata', () => {
    expect(
      buildChatDraftSummary({
        attachmentCount: 2,
        imageGenerationMode: true,
        text: '第一行\n第二行',
      }),
    ).toEqual({ attachmentCount: 2, charCount: 7, lineCount: 2, modeLabel: '图片生成' });
  });

  it('parses fenced code blocks for mobile rendering', () => {
    expect(parseMobileMessageSegments('before\n```ts\nconst ok = true;\n```\nafter')).toEqual([
      { kind: 'text', text: 'before\n' },
      { kind: 'code', language: 'ts', code: 'const ok = true;\n' },
      { kind: 'text', text: '\nafter' },
    ]);
  });

  it('summarizes long code blocks for collapsed mobile rendering', () => {
    const code = Array.from({ length: 16 }, (_, index) => `line ${index + 1}`).join('\n');

    expect(summarizeMobileCodeBlock(code, 3)).toEqual({
      collapsedCode: 'line 1\nline 2\nline 3',
      lineCount: 16,
      shouldCollapse: true,
    });
  });

  it('inserts prompt templates before existing draft text', () => {
    const template = MOBILE_PROMPT_TEMPLATES.find((item) => item.id === 'fix');
    if (!template) {
      throw new Error('Expected fix prompt template to exist');
    }

    expect(insertMobilePromptTemplate('', template.prompt)).toBe(`${template.prompt}\n`);
    expect(insertMobilePromptTemplate('已有内容', template.prompt)).toBe(
      `${template.prompt}\n\n已有内容`,
    );
  });
});
