import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BedrockAuth } from '../utils/bedrock-auth.js';

const CREDENTIAL_KEYS = [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_SHARED_CREDENTIALS_FILE',
] as const;

describe('Bedrock 默认凭证链', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of CREDENTIAL_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CREDENTIAL_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('优先读取环境变量凭证', async () => {
    process.env['AWS_REGION'] = 'us-west-2';
    process.env['AWS_ACCESS_KEY_ID'] = 'AKIA_ENV';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'env-secret';

    const credentials = await Effect.runPromise(BedrockAuth.defaultChain({}));

    expect(credentials).toEqual({
      region: 'us-west-2',
      accessKeyId: 'AKIA_ENV',
      secretAccessKey: 'env-secret',
    });
  });

  it('缺少 AWS_REGION 时从 endpoint URL 推导区域', async () => {
    process.env['AWS_ACCESS_KEY_ID'] = 'AKIA_ENV';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'env-secret';

    const credentials = await Effect.runPromise(
      BedrockAuth.defaultChain({
        url: 'https://bedrock-runtime.eu-west-1.amazonaws.com/model/x/converse-stream',
      }),
    );

    expect(credentials.region).toBe('eu-west-1');
  });

  it('回退到共享凭证文件的 profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bedrock-auth-'));
    const path = join(directory, 'credentials');
    await writeFile(
      path,
      [
        '[default]',
        'aws_access_key_id = AKIA_WRONG',
        '',
        '[work]',
        'aws_access_key_id = AKIA_FILE',
        'aws_secret_access_key = file-secret',
        'aws_session_token = file-token',
        '',
      ].join('\n'),
    );
    process.env['AWS_REGION'] = 'ap-northeast-1';
    process.env['AWS_SHARED_CREDENTIALS_FILE'] = path;
    process.env['AWS_PROFILE'] = 'work';

    const credentials = await Effect.runPromise(BedrockAuth.defaultChain({}));

    expect(credentials).toEqual({
      region: 'ap-northeast-1',
      accessKeyId: 'AKIA_FILE',
      secretAccessKey: 'file-secret',
      sessionToken: 'file-token',
    });
  });

  it('没有任何来源时给出清晰错误', async () => {
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['AWS_SHARED_CREDENTIALS_FILE'] = '/nonexistent/credentials';

    const error = await Effect.runPromise(Effect.flip(BedrockAuth.defaultChain({})));
    expect(error.message).toContain('could not resolve AWS credentials');
  });

  it('resolveRegion 依次取显式值、AWS_REGION、AWS_DEFAULT_REGION', () => {
    process.env['AWS_DEFAULT_REGION'] = 'sa-east-1';
    expect(BedrockAuth.resolveRegion('us-east-1')).toBe('us-east-1');
    expect(BedrockAuth.resolveRegion()).toBe('sa-east-1');
    process.env['AWS_REGION'] = 'eu-central-1';
    expect(BedrockAuth.resolveRegion()).toBe('eu-central-1');
  });
});
