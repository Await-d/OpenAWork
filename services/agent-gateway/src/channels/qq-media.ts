import { channelFetch } from './channel-http.js';
import { channelLogInfo } from './channel-log.js';
import { parseJsonObject, readString } from './qq-api-utils.js';
import type { QQChatTarget } from './qq-target.js';

export interface QQMediaApiContext {
  readonly apiBase: string;
  readonly getAccessToken: () => Promise<string>;
  readonly getNextMsgSeq: (messageId: string) => number;
  readonly sendMessageBody: (
    path: string,
    body: Record<string, unknown>,
  ) => Promise<{ messageId: string }>;
}

interface QQUploadedMedia {
  readonly fileInfo: string;
}

export async function sendQQImage(
  context: QQMediaApiContext,
  target: QQChatTarget,
  input: {
    readonly buffer: Buffer;
    readonly replyToMessageId?: string;
    readonly sourceUrl?: string;
    readonly text?: string;
  },
): Promise<{ messageId: string }> {
  switch (target.type) {
    case 'c2c': {
      const media = await uploadQQImage(
        context,
        `/v2/users/${encodeURIComponent(target.id)}/files`,
        { buffer: input.buffer, sourceUrl: input.sourceUrl },
      );
      return context.sendMessageBody(
        `/v2/users/${encodeURIComponent(target.id)}/messages`,
        buildQQMediaMessageBody(context, media, input.replyToMessageId, input.text),
      );
    }
    case 'group': {
      const media = await uploadQQImage(
        context,
        `/v2/groups/${encodeURIComponent(target.id)}/files`,
        { buffer: input.buffer, sourceUrl: input.sourceUrl },
      );
      return context.sendMessageBody(
        `/v2/groups/${encodeURIComponent(target.id)}/messages`,
        buildQQMediaMessageBody(context, media, input.replyToMessageId, input.text),
      );
    }
    case 'channel':
      throw new Error('QQ channel messages do not support this image sender yet.');
  }
}

function buildQQMediaMessageBody(
  context: QQMediaApiContext,
  media: QQUploadedMedia,
  replyToMessageId?: string,
  text?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    media: { file_info: media.fileInfo },
    msg_type: 7,
    msg_seq: replyToMessageId ? context.getNextMsgSeq(replyToMessageId) : 1,
  };
  const content = text?.trim();
  if (content) {
    body['content'] = content;
  }
  if (replyToMessageId) {
    body['msg_id'] = replyToMessageId;
  }
  return body;
}

async function uploadQQImage(
  context: QQMediaApiContext,
  path: string,
  input: { readonly buffer: Buffer; readonly sourceUrl?: string },
): Promise<QQUploadedMedia> {
  const token = await context.getAccessToken();
  const body = input.sourceUrl
    ? { file_type: 1, url: input.sourceUrl }
    : { file_type: 1, file_data: input.buffer.toString('base64') };
  channelLogInfo('qq media upload started', {
    path,
    fileType: 'image',
    byteLength: input.buffer.byteLength,
    source: input.sourceUrl ? 'url' : 'base64',
  });
  const response = await channelFetch(`${context.apiBase}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `QQBot ${token}`,
    },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
  });
  const rawText = await response.text();
  const data = parseJsonObject(rawText, 'media upload');
  const code = readString(data, 'code');
  if (!response.ok || code) {
    throw new Error(
      `QQ media upload error ${code || response.status}: ${readString(data, 'message') || rawText}`,
    );
  }
  const fileInfo = readString(data, 'file_info');
  if (!fileInfo) {
    throw new Error('QQ media upload succeeded but returned no file_info');
  }
  channelLogInfo('qq media upload completed', {
    path,
    fileType: 'image',
    ttl: readString(data, 'ttl'),
    fileUuid: readString(data, 'file_uuid'),
  });
  return { fileInfo };
}
