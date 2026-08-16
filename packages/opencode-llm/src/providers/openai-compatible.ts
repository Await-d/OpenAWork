import { ProviderID, type ModelID } from '../schema/index.js';
import * as OpenAICompatibleChat from '../protocols/openai-compatible-chat.js';
import type { RouteDefaultsInput } from '../route/client.js';
import { AuthOptions, type ProviderAuthOption } from '../route/auth-options.js';
import { profiles, type OpenAICompatibleProfile } from './openai-compatible-profile.js';

export const id = ProviderID.make('openai-compatible');

type GenericModelOptions = RouteDefaultsInput &
  ProviderAuthOption<'optional'> & {
    readonly provider?: string;
    readonly baseURL: string;
    readonly allowInsecureLocalhost?: boolean;
  };

export type FamilyModelOptions = RouteDefaultsInput &
  ProviderAuthOption<'optional'> & {
    readonly baseURL?: string;
  };

export const routes = [OpenAICompatibleChat.route];

export const configure = (input: GenericModelOptions) => {
  const provider = input.provider ?? 'openai-compatible';
  const {
    provider: _,
    baseURL,
    apiKey: _apiKey,
    auth: _auth,
    allowInsecureLocalhost: _allowInsecureLocalhost,
    ...rest
  } = input;
  const route = OpenAICompatibleChat.route.with({
    ...rest,
    provider,
    endpoint: { baseURL, allowInsecureLocalhost: input.allowInsecureLocalhost },
    auth: AuthOptions.bearer(input, []),
  });
  return {
    id: ProviderID.make(provider),
    model: (modelID: string | ModelID) =>
      route.model({ id: modelID, provider: ProviderID.make(provider) }),
    configure,
  };
};

const define = (profile: OpenAICompatibleProfile) => {
  const configureProfile = (input: FamilyModelOptions = {}) => {
    const facade = configure({
      ...input,
      baseURL: input.baseURL ?? profile.baseURL,
      provider: profile.provider,
    });
    return {
      id: ProviderID.make(profile.provider),
      model: facade.model,
      configure: configureProfile,
    };
  };
  return configureProfile();
};

export const provider = {
  id,
  configure,
};

export const baseten = define(profiles.baseten);
export const cerebras = define(profiles.cerebras);
export const deepinfra = define(profiles.deepinfra);
export const deepseek = define(profiles.deepseek);
export const fireworks = define(profiles.fireworks);
export const groq = define(profiles.groq);
export const togetherai = define(profiles.togetherai);
