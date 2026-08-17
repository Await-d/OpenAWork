import { Config, Effect, Redacted } from 'effect';
import { Headers } from 'effect/unstable/http';
import { LLMError, type LLMRequest } from '../schema/index.js';
export declare class MissingCredentialError extends Error {
  readonly source: string;
  readonly _tag = 'MissingCredentialError';
  constructor(source: string);
}
export type CredentialError = MissingCredentialError | Config.ConfigError;
export type AuthError = CredentialError | LLMError;
type Secret = string | Redacted.Redacted | Config.Config<string | Redacted.Redacted>;
export interface AuthInput {
  readonly request: LLMRequest;
  readonly method: 'POST' | 'GET';
  readonly url: string;
  readonly body: string;
  readonly headers: Headers.Headers;
}
export interface Credential {
  readonly load: Effect.Effect<Redacted.Redacted, CredentialError>;
  readonly orElse: (that: Credential) => Credential;
  readonly bearer: () => Auth;
  readonly header: (name: string) => Auth;
  readonly pipe: <A>(f: (self: Credential) => A) => A;
}
export interface Auth {
  readonly apply: (input: AuthInput) => Effect.Effect<Headers.Headers, AuthError>;
  readonly andThen: (that: Auth) => Auth;
  readonly orElse: (that: Auth) => Auth;
  readonly pipe: <A>(f: (self: Auth) => A) => A;
}
export declare const isAuth: (input: unknown) => input is Auth;
export declare const value: (secret: string, source?: string) => Credential;
export declare const optional: (secret: Secret | undefined, source?: string) => Credential;
export declare const config: (name: string) => Credential;
export declare const effect: (
  load: Effect.Effect<Redacted.Redacted, CredentialError>,
) => Credential;
export declare const none: Auth;
export declare const headers: (input: Headers.Input) => Auth;
export declare const remove: (name: string) => Auth;
export declare const custom: (
  apply: (input: AuthInput) => Effect.Effect<Headers.Headers, LLMError>,
) => Auth;
export declare const passthrough: Auth;
export declare function bearer(source: Secret | Credential): Auth;
export declare const apiKey: typeof bearer;
export declare function header(name: string): (source: Secret | Credential) => Auth;
export declare function header(name: string, source: Secret | Credential): Auth;
export declare function bearerHeader(name: string): (source: Secret | Credential) => Auth;
export declare function bearerHeader(name: string, source: Secret | Credential): Auth;
export declare const toEffect: (
  input: Auth,
) => (authInput: AuthInput) => Effect.Effect<Headers.Headers, LLMError>;
export * as Auth from './auth.js';
//# sourceMappingURL=auth.d.ts.map
