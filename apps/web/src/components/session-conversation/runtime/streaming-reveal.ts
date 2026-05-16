const SENTENCE_PAUSE_CHARACTERS = new Set(['。', '！', '？', '.', '!', '?']);
const CLAUSE_PAUSE_CHARACTERS = new Set(['，', '、', '；', '：', ',', ';', ':']);

export function calculateStreamingRevealStep(pendingCharacters: number): number {
  if (pendingCharacters <= 0) {
    return 0;
  }
  if (pendingCharacters <= 6) {
    return 2;
  }
  if (pendingCharacters <= 20) {
    return 3;
  }
  if (pendingCharacters <= 56) {
    return 5;
  }
  if (pendingCharacters <= 140) {
    return 8;
  }
  if (pendingCharacters <= 320) {
    return 14;
  }
  return 22;
}

export function calculateStreamingRevealDelay(
  lastRevealedCharacter: string | undefined,
  pendingCharacters: number,
): number {
  if (pendingCharacters > 320) {
    return 8;
  }

  if (pendingCharacters > 140) {
    return 10;
  }

  if (!lastRevealedCharacter) {
    return pendingCharacters > 56 ? 12 : 16;
  }

  if (lastRevealedCharacter === '\n') {
    return 96;
  }

  if (SENTENCE_PAUSE_CHARACTERS.has(lastRevealedCharacter)) {
    return 84;
  }

  if (CLAUSE_PAUSE_CHARACTERS.has(lastRevealedCharacter)) {
    return 52;
  }

  if (/\s/u.test(lastRevealedCharacter)) {
    return 18;
  }

  if (pendingCharacters > 56) {
    return 12;
  }

  return 16;
}

export function advanceStreamingReveal(currentVisible: string, targetContent: string): string {
  if (!targetContent.startsWith(currentVisible)) {
    return targetContent;
  }

  const targetCodePoints = Array.from(targetContent);
  const currentVisibleCodePointCount = Array.from(currentVisible).length;
  const pendingCharacters = targetCodePoints.length - currentVisibleCodePointCount;
  if (pendingCharacters <= 0) {
    return currentVisible;
  }

  const nextLength = Math.min(
    targetCodePoints.length,
    currentVisibleCodePointCount + calculateStreamingRevealStep(pendingCharacters),
  );
  return targetCodePoints.slice(0, nextLength).join('');
}
