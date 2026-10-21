import { AuthOptions, type ProviderAuthOption } from '../route/auth-options.js';
import { Route, type RouteDefaultsInput } from '../route/client.js';
import { Endpoint } from '../route/endpoint.js';
import { ProviderID, type ModelID } from '../schema/index.js';
import * as VeniceChat from '../protocols/venice-chat.js';

export const id = ProviderID.make('venice');

const baseURL = 'https://api.venice.ai/api/v1';

export type ModelOptions = RouteDefaultsInput &
  ProviderAuthOption<'optional'> & {
    readonly baseURL?: string;
  };

/**
 * Venice 走**专有协议**（`venice_parameters` / 加密推理 / `thought_signature`），
 * 因此不像其他 OpenAI 兼容供应商那样复用 `OpenAICompatibleChat.route`，而是用它
 * 自己的协议组合路由。
 */
export const route = Route.make({
  id: 'venice-chat',
  provider: id,
  providerMetadataKey: 'venice',
  protocol: VeniceChat.protocol,
  endpoint: Endpoint.path('/chat/completions', { baseURL }),
  framing: VeniceChat.framing,
});

export const routes = [route];

export const configure = (input: ModelOptions = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...rest } = input;
  const configured = route.with({
    ...rest,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth: AuthOptions.bearer(input, 'VENICE_API_KEY'),
  });
  const chat = (modelID: string | ModelID) =>
    configured.model({ id: modelID, compatibility: VeniceChat.compatibility });
  return {
    id,
    model: chat,
    chat,
    configure,
  };
};

export const provider = configure();
export const model = provider.model;
export const chat = provider.chat;
