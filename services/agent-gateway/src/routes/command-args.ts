import { SlashCommandRouterImpl } from '@openAwork/agent-core';

/**
 * 命令参数解析器（提取自 commands.ts，拆分轮次 2/4）。
 *
 * 纯函数集合：把 `/command --key=value 位置参数` 的原始 token 流
 * 解析为命名/位置参数，并做各命令专用的枚举归一化。
 */

export function extractCommandArgs(rawInput: string | undefined, label: string): string[] {
  if (!rawInput) return [];
  const parsed = new SlashCommandRouterImpl().parse(rawInput);
  if (!parsed) return [];
  return `/${parsed.name}` === label ? parsed.args : [];
}

export function parseCommandArgs(args: string[]): {
  named: Record<string, string | boolean>;
  positional: string[];
} {
  const named: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? '';
    if (!current.startsWith('--')) {
      positional.push(current);
      continue;
    }

    const option = current.slice(2);
    const [key, inlineValue] = option.split('=', 2);
    if (!key) continue;
    if (inlineValue !== undefined) {
      named[key] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      named[key] = next;
      index += 1;
      continue;
    }

    named[key] = true;
  }

  return { named, positional };
}

export function parseStringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parsePositiveInteger(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseLoopStrategy(value: string | boolean | undefined): 'continue' | 'reset' {
  return value === 'reset' ? 'reset' : 'continue';
}

export function parseRefactorScope(
  value: string | boolean | undefined,
): 'file' | 'module' | 'project' {
  if (value === 'file' || value === 'project') return value;
  return 'module';
}

export function parseRefactorMode(value: string | boolean | undefined): 'safe' | 'aggressive' {
  return value === 'aggressive' ? 'aggressive' : 'safe';
}

/**
 * `/remove-deadcode --mode=…` parser. `strict` (default) requires
 * deterministic LSP/AST evidence before deletions; `opt-in` lets the
 * agent comment out / mark candidates instead of deleting them, used
 * when the user explicitly asks for a softer first pass.
 */
export function parseDeadcodeMode(value: string | boolean | undefined): 'strict' | 'opt-in' {
  return value === 'opt-in' ? 'opt-in' : 'strict';
}
