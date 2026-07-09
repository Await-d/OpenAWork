import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { isRecord, readRecord, readString } from './inbound-utils.js';
import type { ChannelInstance } from './types.js';

const ED25519_SEED_SIZE = 32;
const ED25519_SIGNATURE_SIZE = 64;
const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface QQWebhookValidation {
  readonly plainToken: string;
  readonly eventTimestamp: string;
}

export function isQQWebhookValidationPayload(body: unknown): body is {
  readonly op: 13;
  readonly d: { readonly plain_token: string; readonly event_ts: string };
} {
  if (!isRecord(body) || body['op'] !== 13) {
    return false;
  }
  const data = readRecord(body, 'd');
  return Boolean(data && readString(data, 'plain_token') && readString(data, 'event_ts'));
}

export function readQQWebhookValidation(body: unknown): QQWebhookValidation | null {
  if (!isQQWebhookValidationPayload(body)) {
    return null;
  }
  const data = readRecord(body, 'd');
  if (!data) {
    return null;
  }
  return {
    plainToken: readString(data, 'plain_token'),
    eventTimestamp: readString(data, 'event_ts'),
  };
}

export function signQQWebhookValidation(input: {
  readonly botSecret: string;
  readonly eventTimestamp: string;
  readonly plainToken: string;
}): string {
  if (!input.botSecret) {
    throw new Error('QQ webhook signing requires bot secret');
  }
  const privateKey = createQQPrivateKey(input.botSecret);
  return sign(null, Buffer.from(`${input.eventTimestamp}${input.plainToken}`), privateKey).toString(
    'hex',
  );
}

export function isAuthorizedQQWebhookRequest(input: {
  readonly appIdHeader: string | null;
  readonly body: unknown;
  readonly channel: ChannelInstance;
  readonly rawBody: Buffer | null;
  readonly signature: string | null;
  readonly timestamp: string | null;
}): boolean {
  if (input.channel.type !== 'qq' || !isExpectedQQAppId(input.channel, input.appIdHeader)) {
    return false;
  }

  if (isQQWebhookValidationPayload(input.body)) {
    return true;
  }

  const botSecret = getQQBotSecret(input.channel);
  if (!botSecret || !input.rawBody || !input.signature || !input.timestamp) {
    return false;
  }

  const signature = Buffer.from(input.signature, 'hex');
  const lastSignatureByte = signature.at(63);
  if (
    signature.length !== ED25519_SIGNATURE_SIZE ||
    lastSignatureByte === undefined ||
    (lastSignatureByte & 224) !== 0
  ) {
    return false;
  }

  const privateKey = createQQPrivateKey(botSecret);
  const publicKey = createPublicKey(privateKey);
  return verify(
    null,
    Buffer.concat([Buffer.from(input.timestamp), input.rawBody]),
    publicKey,
    signature,
  );
}

export function getQQBotSecret(channel: ChannelInstance): string {
  return channel.config['webhookSecret'] || channel.config['clientSecret'] || '';
}

function isExpectedQQAppId(channel: ChannelInstance, appIdHeader: string | null): boolean {
  const configuredAppId = channel.config['appId'];
  return Boolean(configuredAppId && appIdHeader && configuredAppId === appIdHeader);
}

function createQQPrivateKey(botSecret: string): ReturnType<typeof createPrivateKey> {
  if (!botSecret) {
    throw new Error('QQ webhook private key requires bot secret');
  }
  const secret = Buffer.from(botSecret);
  const seed = Buffer.alloc(ED25519_SEED_SIZE);
  for (let offset = 0; offset < seed.length; offset += secret.length) {
    secret.copy(seed, offset, 0, Math.min(secret.length, seed.length - offset));
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}
