import { isRecord, readString } from './inbound-utils.js';
import {
  createMediaUploadContext,
  encodeOutboundMediaAesKey,
  sniffImageMediaType,
  uploadBufferToWeixinCdn,
} from './weixin-media.js';

export interface WeixinSendImageParams {
  readonly toUserId: string;
  readonly contextToken: string;
  readonly buffer: Buffer;
  readonly text?: string;
  readonly cdnBaseUrl?: string;
  readonly signal?: AbortSignal;
}

export interface WeixinSendFileParams {
  readonly toUserId: string;
  readonly contextToken: string;
  readonly buffer: Buffer;
  readonly fileName: string;
  readonly text?: string;
  readonly cdnBaseUrl?: string;
  readonly signal?: AbortSignal;
}

export type WeixinPostJson = (
  path: string,
  body: unknown,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
) => Promise<unknown>;

interface WeixinGetUploadUrlResponse {
  readonly ret?: number;
  readonly errcode?: number;
  readonly errmsg?: string;
  readonly upload_param?: string;
  readonly thumb_upload_param?: string;
  readonly upload_full_url?: string;
}

interface WeixinMediaItemsContext {
  readonly postJson: WeixinPostJson;
}

export async function buildWeixinImageItems(
  params: WeixinSendImageParams,
  context: WeixinMediaItemsContext,
): Promise<readonly Record<string, unknown>[]> {
  if (!sniffImageMediaType(params.buffer)) {
    throw new Error('The provided payload is not a supported image file');
  }
  const uploaded = await uploadMedia(params, 1, context.postJson);
  return buildMediaItems(params.text, {
    type: 2,
    image_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: encodeOutboundMediaAesKey(uploaded.aesKeyHex),
        encrypt_type: 1,
      },
      mid_size: uploaded.fileSizeCiphertext,
    },
  });
}

export async function buildWeixinFileItems(
  params: WeixinSendFileParams,
  context: WeixinMediaItemsContext,
): Promise<readonly Record<string, unknown>[]> {
  const uploaded = await uploadMedia(params, 3, context.postJson);
  return buildMediaItems(params.text, {
    type: 4,
    file_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: encodeOutboundMediaAesKey(uploaded.aesKeyHex),
        encrypt_type: 1,
      },
      file_name: params.fileName,
      len: String(uploaded.fileSize),
    },
  });
}

async function uploadMedia(
  params: WeixinSendImageParams | WeixinSendFileParams,
  mediaType: number,
  postJson: WeixinPostJson,
) {
  const upload = createMediaUploadContext(params.buffer);
  const uploadUrl = normalizeUploadUrlResponse(
    await postJson(
      'ilink/bot/getuploadurl',
      {
        filekey: upload.fileKey,
        media_type: mediaType,
        to_user_id: params.toUserId,
        rawsize: upload.rawSize,
        rawfilemd5: upload.rawFileMd5,
        filesize: upload.fileSizeCiphertext,
        no_need_thumb: true,
        aeskey: upload.aesKeyHex,
        base_info: { channel_version: '1.0.0' },
      },
      { timeoutMs: 20_000, signal: params.signal },
    ),
  );
  const error = readWeixinError(uploadUrl);
  if (error) {
    throw new Error(`Weixin getuploadurl failed: ${error}`);
  }
  const downloadEncryptedQueryParam = await uploadBufferToWeixinCdn({
    buffer: params.buffer,
    uploadParam: uploadUrl.upload_param,
    uploadFullUrl: uploadUrl.upload_full_url,
    fileKey: upload.fileKey,
    cdnBaseUrl: params.cdnBaseUrl,
    aesKey: upload.aesKey,
    signal: params.signal,
  });
  return {
    fileKey: upload.fileKey,
    downloadEncryptedQueryParam,
    aesKeyHex: upload.aesKeyHex,
    fileSize: upload.rawSize,
    fileSizeCiphertext: upload.fileSizeCiphertext,
  };
}

function normalizeUploadUrlResponse(raw: unknown): WeixinGetUploadUrlResponse {
  if (!isRecord(raw)) {
    return {};
  }
  const nested = isRecord(raw['data']) ? normalizeUploadUrlResponse(raw['data']) : {};
  return {
    ret: readNumber(raw, 'ret') ?? nested.ret,
    errcode: readNumber(raw, 'errcode') ?? nested.errcode,
    errmsg: readString(raw, 'errmsg') || nested.errmsg,
    upload_param: readString(raw, 'upload_param') || nested.upload_param,
    thumb_upload_param: readString(raw, 'thumb_upload_param') || nested.thumb_upload_param,
    upload_full_url: readString(raw, 'upload_full_url') || nested.upload_full_url,
  };
}

function buildMediaItems(
  text: string | undefined,
  mediaItem: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  if (!text) {
    return [mediaItem];
  }
  return [{ type: 1, text_item: { text } }, mediaItem];
}

function readWeixinError(raw: unknown): string | null {
  if (!isRecord(raw)) {
    return null;
  }
  const code = readNumber(raw, 'errcode') ?? readNumber(raw, 'ret') ?? 0;
  if (code === 0) {
    return null;
  }
  return readString(raw, 'errmsg') || `errcode ${code}`;
}

function readNumber(data: unknown, key: string): number | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const value = data[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
