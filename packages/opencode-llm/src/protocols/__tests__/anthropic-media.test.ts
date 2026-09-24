import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as LLM from '../../llm.js';
import * as AnthropicMessages from '../anthropic-messages.js';
import { ToolCallPart, type ContentPart } from '../../schema/index.js';

/**
 * Anthropic Messages 媒体对齐（对齐 opencode 参考库）：
 * 图片（base64 / URL / file_id + transformations）与 PDF 文档
 * （base64 / URL / file_id）、text/plain 文本文档、文档 title/context/citations。
 */

const lower = async (content: ReadonlyArray<ContentPart>) => {
  const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
  const request = LLM.request({ model, messages: [{ role: 'user', content: [...content] }] });
  return Effect.runPromise(AnthropicMessages.protocol.body.from(request));
};

const media = (
  mediaType: string,
  data: string,
  extra?: Partial<{ filename: string; metadata: Record<string, unknown> }>,
): ContentPart => ({
  type: 'media',
  mediaType,
  data,
  ...(extra?.filename === undefined ? {} : { filename: extra.filename }),
  ...(extra?.metadata === undefined ? {} : { metadata: extra.metadata }),
});

const firstUserBlock = (body: { messages: ReadonlyArray<{ content: ReadonlyArray<unknown> }> }) =>
  body.messages[0]?.content[0];

describe('Anthropic Messages 媒体对齐', () => {
  it('base64 PDF 降级为 document 块', async () => {
    const body = await lower([
      media('application/pdf', 'data:application/pdf;base64,JVBERi0xLjQ='),
    ]);

    expect(firstUserBlock(body)).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' },
    });
  });

  it('HTTP URL 图片 / PDF 直链降级为 url source', async () => {
    const image = await lower([media('image/png', 'https://example.com/a.png')]);
    expect(firstUserBlock(image)).toMatchObject({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/a.png' },
    });

    const pdf = await lower([media('application/pdf', 'https://example.com/a.pdf')]);
    expect(firstUserBlock(pdf)).toMatchObject({
      type: 'document',
      source: { type: 'url', url: 'https://example.com/a.pdf' },
    });
  });

  it('file_id 元数据降级为 Files API file source', async () => {
    const image = await lower([
      media('image/jpeg', '', { metadata: { anthropic: { file_id: 'file_img' } } }),
    ]);
    expect(firstUserBlock(image)).toMatchObject({
      type: 'image',
      source: { type: 'file', file_id: 'file_img' },
    });

    const pdf = await lower([
      media('application/pdf', '', { metadata: { anthropic: { fileId: 'file_doc' } } }),
    ]);
    expect(firstUserBlock(pdf)).toMatchObject({
      type: 'document',
      source: { type: 'file', file_id: 'file_doc' },
    });
  });

  it('text/plain 降级为文本文档，并透传 title / context / citations', async () => {
    const body = await lower([
      media('text/plain', 'hello doc', {
        filename: 'notes.txt',
        metadata: {
          anthropic: { title: 'Notes', context: 'ctx', citations: { enabled: true } },
        },
      }),
    ]);

    expect(firstUserBlock(body)).toMatchObject({
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: 'hello doc' },
      title: 'Notes',
      context: 'ctx',
      citations: { enabled: true },
    });
  });

  it('图片 transformations 元数据透传', async () => {
    const body = await lower([
      media('image/png', 'data:image/png;base64,iVBORw0KGgo=', {
        metadata: { anthropic: { transformations: { oversized_image: 'downsize' } } },
      }),
    ]);

    expect(firstUserBlock(body)).toMatchObject({
      type: 'image',
      transformations: { oversized_image: 'downsize' },
    });
  });

  it('工具结果的 PDF 附件降级为 document 内容块', async () => {
    const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
    const request = LLM.request({
      model,
      messages: [
        {
          role: 'assistant',
          content: [ToolCallPart.make({ id: 'call_1', name: 'read_pdf', input: {} })],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              id: 'call_1',
              name: 'read_pdf',
              result: {
                type: 'content',
                value: [
                  { type: 'text', text: '附件如下' },
                  {
                    type: 'file',
                    mime: 'application/pdf',
                    uri: 'data:application/pdf;base64,JVBERi0xLjQ=',
                    name: 'doc.pdf',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
    const toolBlock = body.messages[1]?.content[0];
    expect(toolBlock).toMatchObject({
      type: 'tool_result',
      content: [
        { type: 'text', text: '附件如下' },
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf' },
          title: 'doc.pdf',
        },
      ],
    });
  });

  it('不支持的媒体类型显式报错', async () => {
    await expect(lower([media('audio/wav', 'data:audio/wav;base64,UklGRg==')])).rejects.toThrow(
      /does not support media type/,
    );
  });
});
