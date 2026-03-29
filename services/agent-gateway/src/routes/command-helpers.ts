export interface ParsedUlwVerifyDecision {
  decision: 'pass' | 'fail' | null;
  note: string;
}

export function parseUlwVerifyDecision(input: {
  named: Record<string, string | boolean>;
  positional: string[];
}): ParsedUlwVerifyDecision {
  const hasPass = input.named['pass'] !== undefined;
  const hasFail = input.named['fail'] !== undefined;
  if ((hasPass && hasFail) || (!hasPass && !hasFail)) {
    return { decision: null, note: '' };
  }

  const flagValue = hasPass ? input.named['pass'] : input.named['fail'];
  const noteParts = [typeof flagValue === 'string' ? flagValue : null, ...input.positional]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());

  return {
    decision: hasPass ? 'pass' : 'fail',
    note: noteParts.join(' ').trim(),
  };
}
