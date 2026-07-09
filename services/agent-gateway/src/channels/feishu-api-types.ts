export interface FeishuConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly verificationToken: string;
  readonly botOpenId?: string;
  readonly encryptKey?: string;
}

export interface FeishuTokenResponse {
  readonly code: number;
  readonly tenant_access_token: string;
  readonly expire: number;
}

export interface FeishuMessageResponse {
  readonly code: number;
  readonly msg?: string;
  readonly data?: { readonly message_id?: string };
}

export interface FeishuCardUpdateResponse {
  readonly code: number;
}

export const FEISHU_API = 'https://open.feishu.cn/open-apis';

export function parseFeishuMessageId(resp: Response, body: FeishuMessageResponse): string {
  if (!resp.ok) {
    throw new Error(`Feishu send failed: HTTP ${resp.status}`);
  }
  if (body.code !== 0) {
    throw new Error(`Feishu send failed: code ${body.code}${body.msg ? ` (${body.msg})` : ''}`);
  }
  const messageId = body.data?.message_id;
  if (!messageId) {
    throw new Error('Feishu send succeeded but returned no message_id');
  }
  return messageId;
}

export function buildTextCard(content: string): string {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content },
      },
    ],
  });
}
