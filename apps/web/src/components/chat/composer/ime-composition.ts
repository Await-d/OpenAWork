/**
 * 输入法（IME）组合态判定已下沉到 `@openAwork/shared-ui`，由 `apps/web` 与
 * `packages/shared-ui` 共用同一套判定口径。
 *
 * 实现与「为什么必须同时判 `keyCode === 229` 与 `isComposing`」的完整说明见
 * `packages/shared-ui/src/utils/ime-composition.ts`（含 WebKit bug 165004 的成因，
 * 以及「命中时必须直接 return、不得 preventDefault」的调用方契约）。
 *
 * 这里只做再导出，保留原有导出名，两个既有调用点无需改动：
 * `components/chat/composer/ChatComposer.tsx`、
 * `pages/chat-page/conversation/composer/use-composer-callbacks.ts`。
 */
export { isImeComposingKeyboardEvent } from '@openAwork/shared-ui';
