export * from './shared-ui-inline.js';
export * from './shared-ui-mcp.js';
export * from './shared-ui-skills.js';
export * from './shared-ui-provider.js';

// 设计 token 是一组纯常量（无副作用、无依赖），没有值得替身的行为，
// 直接转发真实实现，避免 mock 与 packages/shared-ui/src/tokens.ts 逐渐漂移。
export { tokens } from '../../../../../packages/shared-ui/src/tokens.js';
export type { Tokens } from '../../../../../packages/shared-ui/src/tokens.js';
