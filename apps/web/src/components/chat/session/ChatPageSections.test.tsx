// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';

import {
  createAssistantTraceContent,
  type ChatMessage,
} from '../../conversation-runtime/messages/support.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from './ChatPageSections.js';

afterEach(() => {
  cleanup();
  useDisplayPreferencesStore.setState({ showReasoningBlock: true });
});

describe('renderChatMessageContentWithOptions', () => {
  it('chat 模式隐藏推理时仍保留简化后的占位提示', () => {
    useDisplayPreferencesStore.setState({ showReasoningBlock: false });

    const message: ChatMessage = {
      id: 'assistant-parts-chat',
      role: 'assistant',
      content: '',
      parts: [{ id: 'reasoning-1', type: 'reasoning', text: '先判断入口，再确认渲染分支。' }],
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>);

    expect(screen.getByText('思考过程')).not.toBeNull();
    expect(screen.getByText('已完成')).not.toBeNull();
  });

  it('team 模式隐藏推理时不展示 chat 专属占位提示', () => {
    useDisplayPreferencesStore.setState({ showReasoningBlock: false });

    const message: ChatMessage = {
      id: 'assistant-trace-team',
      role: 'assistant',
      content: createAssistantTraceContent({
        reasoningBlocks: ['先整理上下文，再继续执行。'],
        text: '',
        toolCalls: [],
      }),
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'team' })}</>);

    expect(screen.queryByText('思考过程')).toBeNull();
    expect(screen.queryByText('已完成')).toBeNull();
  });

  it('parts 路径把同一条消息的多个思考块合并为单个展示块', () => {
    const message: ChatMessage = {
      id: 'assistant-multi-reasoning-parts',
      role: 'assistant',
      content: '',
      parts: [
        { id: 'reasoning-1', type: 'reasoning', text: '第一段推理' },
        { id: 'reasoning-2', type: 'reasoning', text: '第二段推理' },
      ],
      reasoningBlocksEndedFlags: [true, true],
      reasoningBlocksDurationsMs: [200, 100],
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>);

    const blocks = document.querySelectorAll('.assistant-reasoning-block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.getAttribute('data-duration-ms')).toBe('300');
    expect(blocks[0]?.getAttribute('data-ended')).toBe('true');
    expect(blocks[0]?.textContent).toContain('第一段推理');
    expect(blocks[0]?.textContent).toContain('第二段推理');
  });

  it('trace 路径把同一条消息的多个思考块合并为单个展示块', () => {
    const message: ChatMessage = {
      id: 'assistant-multi-reasoning-trace',
      role: 'assistant',
      content: createAssistantTraceContent({
        reasoningBlocks: ['trace 第一段', 'trace 第二段'],
        reasoningBlocksTimings: [
          { startedAt: 100, endedAt: 300 },
          { startedAt: 300, endedAt: 500 },
        ],
        text: '',
        toolCalls: [],
      }),
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>);

    const blocks = document.querySelectorAll('.assistant-reasoning-block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.getAttribute('data-duration-ms')).toBe('400');
    expect(blocks[0]?.textContent).toContain('trace 第一段');
    expect(blocks[0]?.textContent).toContain('trace 第二段');
  });

  it('流式 parts 路径只在活动尾部文本段绘制一个光标', () => {
    const message: ChatMessage = {
      id: 'assistant-interleaved-parts',
      role: 'assistant',
      content: '',
      parts: [
        { id: 'text-1', type: 'text', text: '前一段正文。' },
        { id: 'reasoning-1', type: 'reasoning', text: '中途再想一下。' },
        { id: 'text-2', type: 'text', text: '后一段正文。' },
      ],
      reasoningBlocksEndedFlags: [false],
    };

    render(
      <>{renderStreamingChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>,
    );

    const bodies = document.querySelectorAll('.assistant-rich-content-body');
    const cursorOwners = document.querySelectorAll(
      '.assistant-rich-content-body[data-streaming="true"]',
    );
    // 只有一个光标，且挂在 DOM 顺序里的最后一个文本段（text-2）上。
    expect(cursorOwners).toHaveLength(1);
    expect(cursorOwners[0]).toBe(bodies[bodies.length - 1]);
  });

  it('流式 parts 路径在尾部为非文本段时仍保留单个光标', () => {
    const message: ChatMessage = {
      id: 'assistant-trailing-reasoning-parts',
      role: 'assistant',
      content: '',
      parts: [
        { id: 'text-1', type: 'text', text: '先给出的正文。' },
        { id: 'reasoning-1', type: 'reasoning', text: '随后继续思考。' },
      ],
      reasoningBlocksEndedFlags: [false],
    };

    render(
      <>{renderStreamingChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>,
    );

    const bodies = document.querySelectorAll('.assistant-rich-content-body');
    const cursorOwners = document.querySelectorAll(
      '.assistant-rich-content-body[data-streaming="true"]',
    );
    // 尾部是推理块（不绘制光标），光标仍落在最后一个非空文本段（text-1）上，不退化为零。
    expect(cursorOwners).toHaveLength(1);
    expect(cursorOwners[0]).toBe(bodies[0]);
  });
});

describe('思考内容的折叠提示只有一层', () => {
  /** 超过消息级折叠阈值（1500 字符），用于触发 CollapsibleAssistantContent。 */
  const longReasoningText = Array.from(
    { length: 80 },
    (_, index) => `思考行 ${index + 1}：这是一段足够长的推理内容，用于触发消息级折叠阈值。`,
  ).join('\n\n');

  function reasoningMessage(id: string): ChatMessage {
    return {
      id,
      role: 'assistant',
      content: '',
      parts: [{ id: `${id}-reasoning`, type: 'reasoning', text: longReasoningText }],
      reasoningBlocksEndedFlags: [true],
    };
  }

  it('长思考块内部不叠加消息级「展开全部」折叠（折叠态与展开态都不出现）', () => {
    render(
      <>
        {renderChatMessageContentWithOptions(reasoningMessage('long-reasoning'), {
          presentationMode: 'chat',
        })}
      </>,
    );

    const block = document.querySelector('.assistant-reasoning-block');
    expect(block).not.toBeNull();
    // 折叠态：思考块自带 展开，内部不应有第二层折叠容器
    expect(block?.querySelector('.chat-markdown-fold-container')).toBeNull();
    expect(block?.textContent).not.toContain('展开全部');

    fireEvent.click(screen.getByText('展开'));

    // 展开态：思考块自带的 收起 是唯一折叠控件，内容不再被 60vh 二次裁剪
    expect(block?.querySelector('.chat-markdown-fold-container')).toBeNull();
    expect(block?.textContent).not.toContain('展开全部');
    expect(screen.getByText('收起')).not.toBeNull();
  });

  it('关闭推理块显示时，长思考占位展开后同样只有一层折叠', () => {
    useDisplayPreferencesStore.setState({ showReasoningBlock: false });

    render(
      <>
        {renderChatMessageContentWithOptions(reasoningMessage('hidden-long-reasoning'), {
          presentationMode: 'chat',
        })}
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: '思考过程' }));

    const body = document.querySelector('.assistant-reasoning-body');
    expect(body).not.toBeNull();
    expect(body?.querySelector('.chat-markdown-fold-container')).toBeNull();
    expect(body?.textContent).not.toContain('展开全部');
  });

  it('思考块内部的长代码块不再自折叠（展开思考即看到全部内容）', async () => {
    const codeFence = [
      '```ts',
      ...Array.from({ length: 150 }, (_, index) => `const value${index} = ${index};`),
      '```',
    ].join('\n');
    const message: ChatMessage = {
      id: 'long-reasoning-with-code',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'reasoning-code-1',
          type: 'reasoning',
          text: `先写一段代码。\n\n${codeFence}`,
        },
      ],
      reasoningBlocksEndedFlags: [true],
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>);

    const block = document.querySelector('.assistant-reasoning-block');
    expect(block).not.toBeNull();

    fireEvent.click(screen.getByText('展开'));

    // MarkdownMessageContent 在 ChatPageSections 里是 React.lazy：首帧是 Suspense
    // 兜底（裸文本），必须等真实 markdown 渲染出来再断言，否则会假阳性通过。
    await waitFor(() => {
      expect(block?.querySelector('.chat-markdown-code-block')).not.toBeNull();
    });

    // 思考块内部不再出现代码块自己的「展开全部 N 行」
    expect(block?.querySelector('[data-testid="chat-markdown-code-expand"]')).toBeNull();
    expect(block?.querySelector('.chat-markdown-code-block[data-collapsed="true"]')).toBeNull();
    expect(block?.textContent).not.toContain('展开全部');
  });

  it('同一条消息里的长正文仍保留消息级「展开全部」折叠（只对思考内容关闭）', () => {
    const longText = Array.from(
      { length: 80 },
      (_, index) => `正文段落 ${index + 1}：这是一段足够长的正文内容，用于触发消息级折叠阈值。`,
    ).join('\n\n');
    const message: ChatMessage = {
      id: 'long-text-body',
      role: 'assistant',
      content: '',
      parts: [
        { id: 'long-text-reasoning', type: 'reasoning', text: '先想一下正文怎么写。' },
        { id: 'long-text-1', type: 'text', text: longText },
      ],
      reasoningBlocksEndedFlags: [true],
    };

    render(<>{renderChatMessageContentWithOptions(message, { presentationMode: 'chat' })}</>);

    const foldContainers = [...document.querySelectorAll('.chat-markdown-fold-container')];
    expect(foldContainers).toHaveLength(1);
    // 唯一的折叠容器属于正文，不在思考块内部
    expect(foldContainers[0]?.closest('.assistant-reasoning-body')).toBeNull();
    expect(screen.getByText(/展开全部/)).not.toBeNull();
  });
});

function userMessageWithImages(content: Message['content']): ChatMessage {
  return { id: 'user-attached-images', role: 'user', content: '看下这几张图', rawContent: content };
}

function getThumbnail(index: number): HTMLButtonElement {
  const thumbnail = screen.getAllByTitle('点击放大查看')[index];
  if (!(thumbnail instanceof HTMLButtonElement)) throw new Error('附件缩略图未渲染');
  return thumbnail;
}

function getLightboxImage(): HTMLImageElement {
  const image = document.querySelector<HTMLImageElement>('.image-lightbox__image');
  if (!image) throw new Error('查看器图片未渲染');
  return image;
}

function getLightboxButton(name: string): HTMLButtonElement {
  const button = screen.getByRole('button', { name });
  if (!(button instanceof HTMLButtonElement)) throw new Error(`查看器按钮未渲染：${name}`);
  return button;
}

describe('用户附件图集查看器', () => {
  it('多图时可左右切换并同步图集索引', () => {
    render(
      <>
        {renderChatMessageContentWithOptions(
          userMessageWithImages([
            { type: 'input_image', imageUrl: '/attachments/a.png', fileName: 'a.png' },
            { type: 'input_image', imageUrl: '/attachments/b.png', fileName: 'b.png' },
            { type: 'input_image', imageUrl: '/attachments/c.png', fileName: 'c.png' },
          ]),
          { presentationMode: 'chat' },
        )}
      </>,
    );

    fireEvent.click(getThumbnail(0));
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/a.png');
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(getLightboxButton('上一张').disabled).toBe(true);

    fireEvent.click(getLightboxButton('下一张'));
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/b.png');
    expect(screen.getByText('2 / 3')).toBeTruthy();

    fireEvent.click(getLightboxButton('下一张'));
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/c.png');
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(getLightboxButton('下一张').disabled).toBe(true);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/b.png');
    expect(screen.getByText('2 / 3')).toBeTruthy();
  });

  it('单图时不渲染切换按钮，行为与旧版一致', () => {
    render(
      <>
        {renderChatMessageContentWithOptions(
          userMessageWithImages([
            { type: 'input_image', imageUrl: '/attachments/only.png', fileName: 'only.png' },
          ]),
          { presentationMode: 'chat' },
        )}
      </>,
    );

    fireEvent.click(getThumbnail(0));
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/only.png');
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
    expect(document.querySelector('.image-lightbox__counter')).toBeNull();
  });

  it('没有 imageUrl 的附件不进入图集，索引按可预览图片重排', () => {
    render(
      <>
        {renderChatMessageContentWithOptions(
          userMessageWithImages([
            { type: 'input_image', artifactId: 'artifact-without-url' },
            { type: 'input_image', imageUrl: '/attachments/b.png', fileName: 'b.png' },
            { type: 'input_image', imageUrl: '/attachments/c.png', fileName: 'c.png' },
          ]),
          { presentationMode: 'chat' },
        )}
      </>,
    );

    expect(screen.getAllByTitle('点击放大查看')).toHaveLength(2);

    // 第二个缩略图对应图集位置 1（而不是 images 下标 2）
    fireEvent.click(getThumbnail(1));
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/c.png');
    expect(screen.getByText('2 / 2')).toBeTruthy();

    fireEvent.click(getLightboxButton('上一张'));
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/b.png');
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });
});

const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

describe('用户附件文件名控件可访问性', () => {
  const FILE_NAME_BUTTON_NAME = '放大查看 a.png';

  function renderTwoImages() {
    render(
      <>
        {renderChatMessageContentWithOptions(
          userMessageWithImages([
            { type: 'input_image', imageUrl: '/attachments/a.png', fileName: 'a.png' },
            { type: 'input_image', imageUrl: '/attachments/b.png', fileName: 'b.png' },
          ]),
          { presentationMode: 'chat' },
        )}
      </>,
    );
  }

  it('文件名是原生按钮：可 Tab 聚焦、带 aria-label，且不与其它交互元素嵌套', () => {
    renderTwoImages();

    const fileNameButton = screen.getByRole('button', { name: FILE_NAME_BUTTON_NAME });
    expect(fileNameButton.tagName).toBe('BUTTON');
    expect(fileNameButton.getAttribute('type')).toBe('button');
    expect(fileNameButton.getAttribute('aria-label')).toBe(FILE_NAME_BUTTON_NAME);
    expect(fileNameButton.tabIndex).toBe(0);
    // 内联样式会压过伪类，交互态必须全部落在 CSS class 上。
    expect(fileNameButton.getAttribute('style')).toBeNull();

    fileNameButton.focus();
    expect(document.activeElement).toBe(fileNameButton);

    const interactiveNodes = Array.from(
      document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR),
    );
    expect(interactiveNodes.length).toBeGreaterThan(0);
    for (const node of interactiveNodes) {
      expect(node.querySelector(INTERACTIVE_SELECTOR)).toBeNull();
    }
  });

  it('聚焦后 Enter / Space 与鼠标点击走同一激活路径，且按附件索引打开对应图片', () => {
    renderTwoImages();

    const fileNameButton = screen.getByRole('button', { name: FILE_NAME_BUTTON_NAME });
    fileNameButton.focus();
    expect(document.activeElement).toBe(fileNameButton);

    // 原生 <button> 的 Enter / Space 由浏览器合成 click，无需手写 onKeyDown；
    // jsdom 不实现该键盘合成，这里按「聚焦 → 按键 → 合成 click」的浏览器链路验证，
    // 与「放大查看」缩略图按钮用同一套断言口径。
    fireEvent.keyDown(fileNameButton, { key: 'Enter' });
    fireEvent.keyUp(fileNameButton, { key: 'Enter' });
    fireEvent.click(fileNameButton);
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/a.png');

    fireEvent.keyDown(fileNameButton, { key: ' ' });
    fireEvent.keyUp(fileNameButton, { key: ' ' });
    fireEvent.click(fileNameButton);
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/a.png');

    fireEvent.click(screen.getByRole('button', { name: '放大查看 b.png' }));
    expect(getLightboxImage().getAttribute('src')).toBe('/attachments/b.png');
  });

  it('无图源的附件文件名退化为纯文本标签，不产生多余可聚焦控件', () => {
    render(
      <>
        {renderChatMessageContentWithOptions(
          userMessageWithImages([{ type: 'input_image', artifactId: 'artifact-without-url' }]),
          { presentationMode: 'chat' },
        )}
      </>,
    );

    expect(screen.queryByRole('button')).toBeNull();

    const staticLabel = document.querySelector<HTMLElement>('.chat-attachment-file-name--static');
    expect(staticLabel?.tagName).toBe('SPAN');
    expect(staticLabel?.textContent).toBe('图片 1');
    expect(staticLabel?.getAttribute('tabindex')).toBeNull();
  });
});

/** token 断言只看实际声明，避免注释里提到的 token 名干扰 `not.toContain`。 */
function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function readWebSource(relativePath: string): string {
  // vitest 的 root / cwd 是 apps/web（vitest.config.ts 所在目录）。
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('附件缩略图 hover 放大徽标主题 token 使用', () => {
  const cssSource = stripCssComments(
    readWebSource('src/components/chat/session/ChatPageSections.css'),
  );

  it('徽标使用中性浮层 token，禁止 accent 填充文字色与深色硬编码底色', () => {
    // --fg-on-accent 在暗色主题下是近黑色，只允许出现在 accent 实色填充之上。
    expect(cssSource).not.toContain('--fg-on-accent');
    // 历史 bug：徽标曾是 rgba(0,0,0,0.55) 深底 + --fg-on-accent 深字，暗色主题下不可见。
    expect(cssSource).not.toContain('rgba(0,0,0,0.55)');

    expect(cssSource).toContain('background: var(--bg-elevated)');
    expect(cssSource).toContain('color: var(--fg-strong)');
    expect(cssSource).toContain('border: 1px solid var(--border-emphasis)');
  });

  it('tsx 附件图集不再内联徽标颜色，改为渲染 token 化 class', () => {
    const tsxSource = readWebSource('src/components/chat/session/ChatPageSections.tsx');
    const galleryStart = tsxSource.indexOf('function UserAttachedImagesGallery');
    const galleryEnd = tsxSource.indexOf('export function renderChatMessageContentWithOptions');
    expect(galleryStart).toBeGreaterThanOrEqual(0);
    expect(galleryEnd).toBeGreaterThan(galleryStart);

    const gallerySource = stripCssComments(tsxSource.slice(galleryStart, galleryEnd));
    expect(gallerySource).not.toContain('--fg-on-accent');
    expect(gallerySource).not.toContain('rgba(0,0,0,0.55)');
    expect(gallerySource).toContain('chat-attachment-thumbnail__zoom-badge');
  });

  it('渲染出的放大徽标 style 属性为空，样式全部走 class', () => {
    render(
      <>
        {renderChatMessageContentWithOptions(
          userMessageWithImages([
            { type: 'input_image', imageUrl: '/attachments/a.png', fileName: 'a.png' },
          ]),
          { presentationMode: 'chat' },
        )}
      </>,
    );

    const badge = document.querySelector('.chat-attachment-thumbnail__zoom-badge');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('style')).toBeNull();
  });
});

describe('附件文件名控件交互态主题 token 使用', () => {
  const cssSource = stripCssComments(
    readWebSource('src/components/chat/session/ChatPageSections.css'),
  );

  it('覆盖 hover / active / focus-visible，禁止硬编码色值与 accent 实色填充文字色', () => {
    expect(cssSource).not.toContain('--fg-on-accent');
    expect(cssSource).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(cssSource).not.toMatch(/rgba?\(/);

    expect(cssSource).toContain('.chat-attachment-file-name {');
    expect(cssSource).toContain('button.chat-attachment-file-name:hover');
    expect(cssSource).toContain('button.chat-attachment-file-name:active');
    expect(cssSource).toContain('button.chat-attachment-file-name:focus-visible');
    expect(cssSource).toContain('outline: 2px solid var(--accent)');
    expect(cssSource).toContain('box-shadow: 0 0 0 4px var(--accent-subtle)');
    expect(cssSource).toContain('color: var(--fg-muted)');
    expect(cssSource).toContain('.chat-attachment-file-name--static');
  });
});
