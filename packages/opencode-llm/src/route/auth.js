import { Config, Effect, Redacted } from 'effect';
import { Headers } from 'effect/unstable/http';
import { AuthenticationReason, InvalidRequestReason, LLMError } from '../schema/index.js';
export class MissingCredentialError extends Error {
  source;
  _tag = 'MissingCredentialError';
  constructor(source) {
    super(`Missing auth credential: ${source}`);
    this.source = source;
  }
}
export const isAuth = (input) =>
  typeof input === 'object' &&
  input !== null &&
  'apply' in input &&
  typeof input.apply === 'function';
const credential = (load) => {
  const self = {
    load,
    orElse: (that) => credential(load.pipe(Effect.catch(() => that.load))),
    bearer: () => fromCredential(self, (secret) => ({ authorization: `Bearer ${secret}` })),
    header: (name) => fromCredential(self, (secret) => ({ [name]: secret })),
    pipe: (f) => f(self),
  };
  return self;
};
const auth = (apply) => {
  const self = {
    apply,
    andThen: (that) =>
      auth((input) =>
        apply(input).pipe(Effect.flatMap((headers) => that.apply({ ...input, headers }))),
      ),
    orElse: (that) => auth((input) => apply(input).pipe(Effect.catch(() => that.apply(input)))),
    pipe: (f) => f(self),
  };
  return self;
};
const fromCredential = (source, render) =>
  auth((input) =>
    source.load.pipe(
      Effect.map((secret) => Headers.setAll(input.headers, render(Redacted.value(secret)))),
    ),
  );
const secretEffect = (secret, source) => {
  const redacted = typeof secret === 'string' ? Redacted.make(secret) : secret;
  if (Redacted.value(redacted) === '') return Effect.fail(new MissingCredentialError(source));
  return Effect.succeed(redacted);
};
const credentialFromSecret = (secret, source) => {
  if (typeof secret === 'string' || Redacted.isRedacted(secret))
    return credential(secretEffect(secret, source));
  return credential(
    Effect.gen(function* () {
      return yield* secretEffect(yield* secret, source);
    }),
  );
};
export const value = (secret, source = 'value') => credentialFromSecret(secret, source);
export const optional = (secret, source = 'optional value') =>
  secret === undefined
    ? credential(Effect.fail(new MissingCredentialError(source)))
    : credentialFromSecret(secret, source);
export const config = (name) => credentialFromSecret(Config.redacted(name), name);
export const effect = (load) => credential(load);
export const none = auth((input) => Effect.succeed(input.headers));
export const headers = (input) =>
  auth((inputAuth) => Effect.succeed(Headers.setAll(inputAuth.headers, input)));
export const remove = (name) =>
  auth((input) => Effect.succeed(Headers.remove(input.headers, name)));
export const custom = (apply) => auth(apply);
export const passthrough = none;
const credentialInput = (source) =>
  typeof source === 'string' || Redacted.isRedacted(source) || Config.isConfig(source)
    ? credentialFromSecret(source, 'value')
    : source;
export function bearer(source) {
  return credentialInput(source).bearer();
}
export const apiKey = bearer;
export function header(name, source) {
  if (source === undefined) {
    return (next) => credentialInput(next).header(name);
  }
  return credentialInput(source).header(name);
}
export function bearerHeader(name, source) {
  const render = (input) =>
    fromCredential(credentialInput(input), (secret) => ({ [name]: `Bearer ${secret}` }));
  if (source === undefined) return render;
  return render(source);
}
const toLLMError = (error) => {
  if (error instanceof MissingCredentialError || error instanceof Config.ConfigError) {
    return new LLMError({
      module: 'Auth',
      method: 'apply',
      reason:
        error instanceof MissingCredentialError
          ? new AuthenticationReason({ message: error.message, kind: 'missing' })
          : new InvalidRequestReason({
              message: `Failed to resolve auth config: ${error.message}`,
            }),
    });
  }
  return error;
};
export const toEffect = (input) => (authInput) =>
  input.apply(authInput).pipe(Effect.mapError(toLLMError));
export * as Auth from './auth.js';
//# sourceMappingURL=auth.js.map
