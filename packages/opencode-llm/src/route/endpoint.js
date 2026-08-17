import * as ProviderShared from '../protocols/shared.js';
import { validateProviderBaseUrl } from '../provider/types.js';
/** Construct an `Endpoint` from a path string or path function. */
export const path = (value, options = {}) => ({
  ...options,
  path: value,
});
export const merge = (base, patch) => ({
  ...base,
  ...patch,
  baseURL: patch.baseURL ?? base.baseURL,
  path: patch.path ?? base.path,
  query: patch.query === undefined ? base.query : { ...base.query, ...patch.query },
  ...((patch.allowInsecureLocalhost ?? base.allowInsecureLocalhost) === undefined
    ? {}
    : { allowInsecureLocalhost: patch.allowInsecureLocalhost ?? base.allowInsecureLocalhost }),
});
export const validate = (endpoint) => {
  validateProviderBaseUrl(endpoint.baseURL, {
    allowInsecureLocalhost: endpoint.allowInsecureLocalhost,
  });
};
const renderPart = (part, input) => (typeof part === 'function' ? part(input) : part);
export const render = (endpoint, input) => {
  validate(endpoint);
  const url = new URL(
    `${ProviderShared.trimBaseUrl(endpoint.baseURL ?? '')}${renderPart(endpoint.path, input)}`,
  );
  for (const [key, value] of Object.entries(endpoint.query ?? {})) url.searchParams.set(key, value);
  return url;
};
export * as Endpoint from './endpoint.js';
//# sourceMappingURL=endpoint.js.map
