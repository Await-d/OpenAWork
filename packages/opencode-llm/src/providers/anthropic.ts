import type { RouteDefaultsInput } from '../route/client.js';
import { Auth } from '../route/auth.js';
import type { ProviderAuthOption } from '../route/auth-options.js';
import { ProviderID, type ModelID } from '../schema/index.js';
import * as AnthropicMessages from '../protocols/anthropic-messages.js';

export const id = ProviderID.make('anthropic');

export const routes = [AnthropicMessages.route];

export type Config = RouteDefaultsInput &
  ProviderAuthOption<'optional'> & {
    readonly baseURL?: string;
    readonly allowInsecureLocalhost?: boolean;
  };

const auth = (options: ProviderAuthOption<'optional'>) => {
  if ('auth' in options && options.auth) return options.auth;
  return Auth.optional('apiKey' in options ? options.apiKey : undefined, 'apiKey')
    .orElse(Auth.config('ANTHROPIC_API_KEY'))
    .pipe(Auth.header('x-api-key'));
};

const configuredRoute = (input: Config) => {
  const { apiKey: _, auth: _auth, baseURL, allowInsecureLocalhost, ...rest } = input;
  return AnthropicMessages.route.with({
    ...rest,
    endpoint: { baseURL, ...(allowInsecureLocalhost ? { allowInsecureLocalhost: true } : {}) },
    auth: auth(input),
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
