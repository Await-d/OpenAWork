const DEFAULT_CHARACTER_LIMIT = 8000;
const MIN_CHARACTER_LIMIT = 500;
const CHARS_PER_TOKEN_ESTIMATE = 4;

export type ComposerCharacterTone = 'normal' | 'warning' | 'danger';

export interface ComposerCharacterCount {
  readonly count: number;
  readonly limit: number;
  readonly tone: ComposerCharacterTone;
  readonly label: string;
}

export function getComposerCharacterLimit(contextMaxTokens?: number): number {
  if (contextMaxTokens === undefined || contextMaxTokens <= 0) {
    return DEFAULT_CHARACTER_LIMIT;
  }
  return Math.max(MIN_CHARACTER_LIMIT, Math.round(contextMaxTokens / CHARS_PER_TOKEN_ESTIMATE));
}

export function getComposerCharacterCount(
  text: string,
  contextMaxTokens?: number,
): ComposerCharacterCount {
  const limit = getComposerCharacterLimit(contextMaxTokens);
  const count = text.length;
  const ratio = count / limit;
  const tone: ComposerCharacterTone = ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'normal';

  return {
    count,
    limit,
    tone,
    label: `${count.toLocaleString()} / ${limit.toLocaleString()} 字符`,
  };
}
