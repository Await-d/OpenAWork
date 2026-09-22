/**
 * Legacy tool-name rewrite
 *
 * Legacy OpenAI function-calling payloads namespace every tool name as
 * `functions.<name>` (e.g. `functions.bash`, `functions.Agent`). A single leading
 * `functions.` prefix is stripped before dispatch so those requests resolve to
 * the same canonical names as their bare counterparts; the stripped name is
 * returned even when nothing else changes, letting downstream dispatch handle it.
 *
 * 历史上这里还有一张「旧工具名 → 规范名」的改名表（覆盖更早版本的文件、检索与
 * shell 工具名），已于 2026-09-22 删除：实测 5 个月 21,115 次工具执行里那些旧名
 * 零调用，模型可见面也已只剩规范名。本模块现在**不承担任何改名职责**——一个工具
 * 只有一个名字是硬约定，避免模型在历史记录与工具列表间看到两个名字。
 *
 * NOTE: `stripFunctionsNamespacePrefix` 与 `routes/tool-name-compat.ts` 的启用
 * 门禁共用同一条规则，两侧必须保持一致。
 */

const OPENAI_FUNCTIONS_PREFIX = 'functions.';

export interface LegacyRewriteResult {
  toolName: string;
  rawInput: unknown;
  rewritten: boolean;
}

/**
 * Remove a single leading `functions.` namespace prefix (legacy OpenAI
 * function-calling payloads). Only the very first occurrence is stripped:
 * `functions.functions.x` becomes `functions.x`, and names without the
 * prefix pass through untouched.
 */
export function stripFunctionsNamespacePrefix(toolName: string): string {
  if (!toolName.startsWith(OPENAI_FUNCTIONS_PREFIX)) {
    return toolName;
  }
  return toolName.slice(OPENAI_FUNCTIONS_PREFIX.length);
}

/**
 * Rewrite a legacy tool request (name + raw input) to its canonical form.
 * The only remaining rewrite is stripping a single leading `functions.` prefix;
 * `rawInput` is always forwarded untouched. Returns the original request
 * untouched when no rewriting applies.
 */
export function rewriteLegacyToolRequest(toolName: string, rawInput: unknown): LegacyRewriteResult {
  const unprefixedName = stripFunctionsNamespacePrefix(toolName);
  if (unprefixedName === toolName) {
    return { toolName, rawInput, rewritten: false };
  }
  return { toolName: unprefixedName, rawInput, rewritten: true };
}
