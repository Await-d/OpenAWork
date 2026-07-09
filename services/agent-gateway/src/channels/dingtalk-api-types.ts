import { createHmac } from 'node:crypto';

export interface DingTalkConfig {
  webhookUrl: string;
  secret?: string;
  appKey?: string;
  appSecret?: string;
  robotCode?: string;
  cardTemplateId?: string;
}

export interface DingTalkWebhookResponse {
  errcode: number;
  errmsg: string;
}

export interface DingTalkTokenResponse {
  errcode: number;
  access_token: string;
  expires_in: number;
}

export interface DingTalkSendResponse {
  processQueryKey: string;
  requestId: string;
}

export const DINGTALK_API = 'https://oapi.dingtalk.com';
export const DINGTALK_NEW_API = 'https://api.dingtalk.com/v1.0';

export function signWebhook(secret: string, timestamp: number): string {
  const payload = `${timestamp}\n${secret}`;
  return encodeURIComponent(createHmac('sha256', secret).update(payload).digest('base64'));
}

export function normalizeDingTalkConfig(config: Record<string, string>): DingTalkConfig {
  return {
    webhookUrl: config['webhookUrl'] ?? '',
    secret: config['secret'],
    appKey: config['appKey'],
    appSecret: config['appSecret'],
    robotCode: config['robotCode'],
    cardTemplateId: config['cardTemplateId'],
  };
}
