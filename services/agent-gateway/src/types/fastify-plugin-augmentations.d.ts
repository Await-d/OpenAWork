/* eslint-disable @typescript-eslint/no-unused-vars */

import type {
  ContextConfigDefault,
  FastifyBaseLogger,
  FastifyRequest,
  FastifySchema,
  FastifyTypeProvider,
  FastifyTypeProviderDefault,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerBase,
  RawServerDefault,
  RequestGenericInterface,
} from 'fastify';
import type * as Ws from 'ws';

interface GatewayJwtApi {
  sign(payload: unknown, options?: unknown): string;
  verify<Decoded = unknown>(token: string, options?: unknown): Decoded;
  decode<Decoded = unknown>(token: string, options?: unknown): Decoded | null;
  lookupToken(request: FastifyRequest, options?: unknown): string;
}

type GatewayWebsocketHandler<
  RawServer extends RawServerBase = RawServerDefault,
  RawRequest extends RawRequestDefaultExpression<RawServer> =
    RawRequestDefaultExpression<RawServer>,
  RequestGeneric extends RequestGenericInterface = RequestGenericInterface,
  ContextConfig = ContextConfigDefault,
  SchemaCompiler extends FastifySchema = FastifySchema,
  TypeProvider extends FastifyTypeProvider = FastifyTypeProviderDefault,
  Logger extends FastifyBaseLogger = FastifyBaseLogger,
> = (
  socket: Ws.WebSocket,
  request: FastifyRequest<
    RequestGeneric,
    RawServer,
    RawRequest,
    SchemaCompiler,
    TypeProvider,
    ContextConfig,
    Logger
  >,
) => void | Promise<unknown>;

declare module 'fastify' {
  interface FastifyInstance<
    RawServer extends RawServerBase = RawServerDefault,
    RawRequest extends RawRequestDefaultExpression<RawServer> =
      RawRequestDefaultExpression<RawServer>,
    RawReply extends RawReplyDefaultExpression<RawServer> = RawReplyDefaultExpression<RawServer>,
    Logger extends FastifyBaseLogger = FastifyBaseLogger,
    TypeProvider extends FastifyTypeProvider = FastifyTypeProviderDefault,
  > {
    jwt: GatewayJwtApi;
    swagger: (opts?: { yaml?: boolean }) => unknown;
    swaggerCSP: {
      script: string[];
      style: string[];
    };
  }

  interface FastifyRequest {
    jwtVerify<Decoded = unknown>(options?: unknown): Promise<Decoded>;
    jwtDecode<Decoded = unknown>(options?: unknown): Promise<Decoded | null>;
    user?: unknown;
    ws: boolean;
  }

  interface FastifySchema {
    hide?: boolean;
    deprecated?: boolean;
    tags?: readonly string[];
    description?: string;
    summary?: string;
    consumes?: readonly string[];
    produces?: readonly string[];
    externalDocs?: unknown;
    security?: ReadonlyArray<Record<string, readonly string[]>>;
    operationId?: string;
  }

  interface InjectWSOption {
    onInit?: (ws: Ws.WebSocket) => void;
    onOpen?: (ws: Ws.WebSocket) => void;
  }

  interface RouteShorthandOptions<RawServer extends RawServerBase = RawServerDefault> {
    websocket?: boolean;
  }

  interface FastifyInstance<RawServer, RawRequest, RawReply, Logger, TypeProvider> {
    websocketServer: Ws.Server;
    injectWS: (
      path?: string,
      upgradeContext?: Partial<RawRequest>,
      options?: InjectWSOption,
    ) => Promise<Ws.WebSocket>;
  }

  interface RouteShorthandMethod<
    RawServer extends RawServerBase = RawServerDefault,
    RawRequest extends RawRequestDefaultExpression<RawServer> =
      RawRequestDefaultExpression<RawServer>,
    RawReply extends RawReplyDefaultExpression<RawServer> = RawReplyDefaultExpression<RawServer>,
    TypeProvider extends FastifyTypeProvider = FastifyTypeProviderDefault,
    Logger extends FastifyBaseLogger = FastifyBaseLogger,
  > {
    <
      RequestGeneric extends RequestGenericInterface = RequestGenericInterface,
      ContextConfig = ContextConfigDefault,
      SchemaCompiler extends FastifySchema = FastifySchema,
      InnerLogger extends Logger = Logger,
    >(
      path: string,
      opts: RouteShorthandOptions<
        RawServer,
        RawRequest,
        RawReply,
        RequestGeneric,
        ContextConfig,
        SchemaCompiler,
        TypeProvider,
        InnerLogger
      > & { websocket: true },
      handler?: GatewayWebsocketHandler<
        RawServer,
        RawRequest,
        RequestGeneric,
        ContextConfig,
        SchemaCompiler,
        TypeProvider,
        InnerLogger
      >,
    ): FastifyInstance<RawServer, RawRequest, RawReply, InnerLogger, TypeProvider>;
  }

  interface FastifyContextConfig {
    swaggerTransform?: (input: {
      schema: FastifySchema;
      url: string;
      route: unknown;
      swaggerObject?: unknown;
      openapiObject?: unknown;
    }) => { schema: FastifySchema; url: string };
    swagger?: {
      exposeHeadRoute?: boolean;
    };
  }
}
