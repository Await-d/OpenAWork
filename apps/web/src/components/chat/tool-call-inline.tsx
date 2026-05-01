/**
 * Legacy entry point for the chat tool-call rendering subsystem.
 *
 * The implementation lives in `./tool-call/`, split per tool / preview /
 * router. This file is kept only as a barrel re-export so external
 * consumers (`ChatPageSections.tsx`, the test file) and any future
 * imports of `./tool-call-inline.js` continue to work unchanged.
 *
 * To add a new tool's specialised renderer:
 *   1. Drop a new component + extractor file under `./tool-call/previews/`.
 *   2. Add a route case in `./tool-call/tool-output-preview.tsx`.
 *   3. Re-export the new symbols from `./tool-call/index.ts` if tests need
 *      to reach them directly.
 */
export * from './tool-call/index.js';
