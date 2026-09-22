import type { RouteDefaultsInput } from '../route/client.js';
import { Auth } from '../route/auth.js';
import { ProviderID, type ModelID } from '../schema/index.js';
import * as BedrockConverse from '../protocols/bedrock-converse.js';
import type { BedrockCredentials } from '../protocols/bedrock-converse.js';
import { BedrockAuth } from '../protocols/utils/bedrock-auth.js';

export const id = ProviderID.make('amazon-bedrock');

export type Config = RouteDefaultsInput & {
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  readonly credentials?: BedrockCredentials;
  /** AWS region. Defaults to `us-east-1` when neither this nor `credentials.region` is set. */
  readonly region?: string;
  /** Override the computed `https://bedrock-runtime.<region>.amazonaws.com` URL. */
  readonly baseURL?: string;
};
export const routes = [BedrockConverse.route];

const bedrockBaseURL = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com`;

const configuredRoute = (input: Config) => {
  const { apiKey, credentials, region, baseURL, ...rest } = input;
  // Keep the endpoint region and the signing region aligned: env is consulted
  // before falling back so the default credential chain signs for the same
  // region the URL targets.
  const resolvedRegion =
    region ?? credentials?.region ?? BedrockAuth.resolveRegion() ?? 'us-east-1';
  return BedrockConverse.route.with({
    ...rest,
    provider: id,
    endpoint: { baseURL: baseURL ?? bedrockBaseURL(resolvedRegion) },
    auth:
      apiKey !== undefined
        ? Auth.bearer(apiKey)
        : credentials !== undefined
          ? BedrockConverse.sigV4Auth(credentials)
          : BedrockAuth.auth,
  });
};

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input);
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  };
};

export const provider = configure();
export const model = provider.model;
