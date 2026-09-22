import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AwsV4Signer } from 'aws4fetch';
import { Effect } from 'effect';
import { Headers } from 'effect/unstable/http';
import { Auth, type AuthInput } from '../../route/auth.js';
import type { LLMError } from '../../schema/index.js';
import { ProviderShared } from '../shared.js';

/**
 * AWS credentials for SigV4 signing. Bedrock also supports Bearer API key auth,
 * which provider facades configure as route auth instead of SigV4. STS-vended
 * credentials should be refreshed by the consumer (rebuild the model) before
 * they expire; the route does not refresh.
 */
export interface Credentials {
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

/**
 * Either fixed credentials or a per-request resolver. The resolver form lets
 * the default credential chain read the request URL (for the region) and
 * re-resolve credentials on every call so rotated env/file values are picked up.
 */
export type CredentialResolver = (input: AuthInput) => Effect.Effect<Credentials, LLMError>;

const signRequest = (input: {
  readonly url: string;
  readonly body: string;
  readonly headers: Headers.Headers;
  readonly credentials: Credentials;
}) =>
  Effect.tryPromise({
    try: async () => {
      const signed = await new AwsV4Signer({
        url: input.url,
        method: 'POST',
        headers: Object.entries(input.headers),
        body: input.body,
        region: input.credentials.region,
        accessKeyId: input.credentials.accessKeyId,
        secretAccessKey: input.credentials.secretAccessKey,
        sessionToken: input.credentials.sessionToken,
        service: 'bedrock',
      }).sign();
      return Object.fromEntries(signed.headers.entries());
    },
    catch: (error) =>
      ProviderShared.invalidRequest(
        `Bedrock Converse SigV4 signing failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });

/** Sign the exact JSON bytes with SigV4 using fixed credentials or a resolver. */
export const sigV4 = (credentials: Credentials | CredentialResolver) =>
  Auth.custom((input: AuthInput) =>
    Effect.gen(function* () {
      const resolved = typeof credentials === 'function' ? yield* credentials(input) : credentials;
      const headersForSigning = Headers.set(input.headers, 'content-type', 'application/json');
      const signed = yield* signRequest({
        url: input.url,
        body: input.body,
        headers: headersForSigning,
        credentials: resolved,
      });
      return Headers.setAll(headersForSigning, signed);
    }),
  );

const nonEmpty = (value: string | undefined): string | undefined =>
  value !== undefined && value.length > 0 ? value : undefined;

const regionFromUrl = (url: string): string | undefined => {
  try {
    const match = /^bedrock-runtime\.([a-z0-9-]+)\./.exec(new URL(url).hostname);
    return match?.[1];
  } catch {
    return undefined;
  }
};

/** Explicit region, then `AWS_REGION`, then `AWS_DEFAULT_REGION`. */
export const resolveRegion = (explicit?: string): string | undefined =>
  nonEmpty(explicit) ??
  nonEmpty(process.env['AWS_REGION']) ??
  nonEmpty(process.env['AWS_DEFAULT_REGION']);

const credentialsFromEnv = (region: string | undefined): Credentials | undefined => {
  const accessKeyId = nonEmpty(process.env['AWS_ACCESS_KEY_ID']);
  const secretAccessKey = nonEmpty(process.env['AWS_SECRET_ACCESS_KEY']);
  if (region === undefined || accessKeyId === undefined || secretAccessKey === undefined)
    return undefined;
  const sessionToken = nonEmpty(process.env['AWS_SESSION_TOKEN']);
  return {
    region,
    accessKeyId,
    secretAccessKey,
    ...(sessionToken === undefined ? {} : { sessionToken }),
  };
};

// Minimal INI reader for `~/.aws/credentials`: one `[profile]` section whose
// `key = value` pairs we need. Anything malformed is skipped rather than failing
// the credential lookup.
const parseProfile = (text: string, profile: string): Record<string, string> => {
  const values: Record<string, string> = {};
  let inProfile = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      inProfile = section[1]!.trim() === profile;
      continue;
    }
    if (!inProfile) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
};

const credentialsFromSharedFile = (
  region: string | undefined,
): Effect.Effect<Credentials | undefined> =>
  Effect.gen(function* () {
    if (region === undefined) return undefined;
    const profile =
      nonEmpty(process.env['AWS_PROFILE']) ??
      nonEmpty(process.env['AWS_DEFAULT_PROFILE']) ??
      'default';
    const path =
      nonEmpty(process.env['AWS_SHARED_CREDENTIALS_FILE']) ??
      join(homedir(), '.aws', 'credentials');
    // A missing/unreadable credentials file is a normal "no credentials here",
    // not a hard failure: the next source in the chain decides.
    const text = yield* Effect.promise(() =>
      readFile(path, 'utf8').then(
        (value) => value,
        () => undefined,
      ),
    );
    if (text === undefined) return undefined;
    const values = parseProfile(text, profile);
    const accessKeyId = values['aws_access_key_id'];
    const secretAccessKey = values['aws_secret_access_key'];
    if (accessKeyId === undefined || secretAccessKey === undefined) return undefined;
    const sessionToken = values['aws_session_token'];
    return {
      region,
      accessKeyId,
      secretAccessKey,
      ...(sessionToken === undefined ? {} : { sessionToken }),
    };
  });

/**
 * Dependency-free default credential chain: process environment first, then the
 * shared credentials file (`AWS_SHARED_CREDENTIALS_FILE` or `~/.aws/credentials`
 * profile). Instance metadata / SSO / web identity are intentionally out of
 * scope (they need the AWS SDK); callers that rely on them should pass explicit
 * credentials to `sigV4`.
 */
export const defaultChain = (input: {
  readonly url?: string;
  readonly region?: string;
}): Effect.Effect<Credentials, LLMError> =>
  Effect.gen(function* () {
    const region =
      resolveRegion(input.region) ?? (input.url ? regionFromUrl(input.url) : undefined);
    const fromEnv = credentialsFromEnv(region);
    if (fromEnv) return fromEnv;
    const fromFile = yield* credentialsFromSharedFile(region);
    if (fromFile) return fromFile;
    return yield* ProviderShared.invalidRequest(
      'Bedrock Converse could not resolve AWS credentials from the environment or the shared credentials file; configure route bearer auth, explicit credentials, AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, or an AWS_PROFILE whose region is set',
    );
  });

/** Bedrock route auth defaults to SigV4 backed by the default credential chain. */
export const auth = sigV4((input) => defaultChain({ url: input.url }));

export * as BedrockAuth from './bedrock-auth.js';
