/**
 * find-my-way (Fastify's router) caps a single path parameter at 100 chars by
 * default (`maxParamLength`). Several gateway resources address rows by
 * server-generated composite ids that legitimately exceed that — most notably
 * notification ids shaped as
 * `notification:<sessionId>:<eventType>:<scope>:<seq>` (~105+ chars). When a
 * parameter overflows the cap the route simply does not match and Fastify
 * returns its default "Not Found", so e.g. POST /notifications/:notificationId/read
 * silently 404s even though the handler would have happily processed it.
 *
 * Raise the cap well above any id we generate. ids are server-side and bounded
 * (uuid + bounded prefixes), so a generous fixed limit is safe and keeps the
 * length protection meaningful against pathological inputs.
 *
 * Shared between the production server (`index.ts`) and route tests so the
 * regression coverage exercises the same router configuration.
 */
export const GATEWAY_MAX_PARAM_LENGTH = 512;
