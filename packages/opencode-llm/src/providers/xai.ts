import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile.js"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat.js"
import * as OpenAIResponses from "../protocols/openai-responses.js"

export const id = ProviderID.make("xai")

export type ModelOptions = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

export const routes = [OpenAIResponses.route, OpenAICompatibleChat.route]

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "XAI_API_KEY")

const configuredResponsesRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return OpenAIResponses.route.with({
    ...rest,
    provider: id,
    endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
    auth: auth(input),
  })
}

const configuredChatRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return OpenAICompatibleChat.route.with({
    ...rest,
    provider: id,
    endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
    auth: auth(input),
  })
}

export const configure = (input: ModelOptions = {}) => {
  const responsesRoute = configuredResponsesRoute(input)
  const chatRoute = configuredChatRoute(input)
  const responses = (modelID: string | ModelID) => responsesRoute.model({ id: modelID })
  const chat = (modelID: string | ModelID) => chatRoute.model({ id: modelID })
  return {
    id,
    model: responses,
    responses,
    chat,
    configure,
  }
}

export const provider = configure()
export const model = provider.model
export const responses = provider.responses
export const chat = provider.chat



