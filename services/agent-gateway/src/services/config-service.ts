import { Context, Effect, Layer } from 'effect';
import type { ConfigServiceShape, GatewayConfig } from '../types/effect-services.js';

export type { GatewayConfig } from '../types/effect-services.js';

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;

export interface ConfigServiceOptions {
  readonly env?: ConfigEnvironment;
  readonly overrides?: Partial<GatewayConfig>;
}

const DEFAULT_CONFIG: GatewayConfig = {
  gatewayHost: '127.0.0.1',
  gatewayPort: 3000,
  aiApiBaseUrl: 'https://api.openai.com/v1',
  aiDefaultModel: 'gpt-4o-mini',
};

const readPort = (value: string | undefined): number => {
  if (value === undefined || value.trim() === '') return DEFAULT_CONFIG.gatewayPort;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535
    ? parsed
    : DEFAULT_CONFIG.gatewayPort;
};

export const loadGatewayConfig = (
  env: ConfigEnvironment = process.env,
  overrides: Partial<GatewayConfig> = {},
): GatewayConfig => ({
  ...DEFAULT_CONFIG,
  gatewayHost: env.GATEWAY_HOST?.trim() || DEFAULT_CONFIG.gatewayHost,
  gatewayPort: readPort(env.GATEWAY_PORT),
  ...(env.OPENAWORK_DATA_DIR === undefined ? {} : { dataDir: env.OPENAWORK_DATA_DIR }),
  ...(env.OPENAWORK_DATABASE_PATH === undefined
    ? {}
    : { databasePath: env.OPENAWORK_DATABASE_PATH }),
  ...(env.AI_API_KEY === undefined ? {} : { aiApiKey: env.AI_API_KEY }),
  aiApiBaseUrl: env.AI_API_BASE_URL?.trim() || DEFAULT_CONFIG.aiApiBaseUrl,
  aiDefaultModel: env.AI_DEFAULT_MODEL?.trim() || DEFAULT_CONFIG.aiDefaultModel,
  ...overrides,
});

export class ConfigService extends Context.Service<ConfigService, ConfigServiceShape>()(
  '@openAwork/EffectConfigService',
) {
  static live(options: ConfigServiceOptions = {}): Layer.Layer<ConfigService> {
    const config = loadGatewayConfig(options.env, options.overrides);
    return ConfigService.test(config);
  }

  static test(config: Partial<GatewayConfig> = {}): Layer.Layer<ConfigService> {
    const resolvedConfig = loadGatewayConfig({}, config);
    const all = Effect.succeed(resolvedConfig);
    return Layer.succeed(ConfigService, {
      all,
      get: <K extends keyof GatewayConfig>(key: K): Effect.Effect<GatewayConfig[K]> =>
        Effect.succeed(resolvedConfig[key]),
    });
  }
}
