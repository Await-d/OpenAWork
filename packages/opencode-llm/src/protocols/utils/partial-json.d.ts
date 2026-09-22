export * from './partial-json-options.js';
export declare class PartialJSON extends Error {}
export declare class MalformedJSON extends Error {}
/**
 * Parse complete or incomplete JSON, restricted by the supplied partial-value
 * flags. Providers stream tool-call arguments, so a call can arrive truncated
 * (`{"path": "/tmp/`) or with a control character written raw inside a string
 * instead of escaped; both are recovered here rather than failing the stream.
 */
export declare function parseJSON(jsonString: string, allowPartial?: number): unknown;
export declare const parse: typeof parseJSON;
//# sourceMappingURL=partial-json.d.ts.map
