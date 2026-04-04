import type { ExtractedMemoryCandidate, MemoryType } from './types.js';

interface ExtractionPattern {
  pattern: RegExp;
  type: MemoryType;
  keyExtractor: (match: RegExpMatchArray) => string;
  valueExtractor: (match: RegExpMatchArray) => string;
  confidence: number;
}

const EXTRACTION_PATTERNS: ExtractionPattern[] = [
  {
    pattern:
      /(?:我(?:的)?(?:偏好|喜欢|习惯|倾向于|总是|一般|通常|首选)(?:是|用|使用)?)\s*[:：]?\s*(.+)/gi,
    type: 'preference',
    keyExtractor: (_match) => 'user_preference',
    valueExtractor: (match) => match[1]?.trim() ?? '',
    confidence: 0.6,
  },
  {
    pattern: /(?:(?:请)?(?:记住|记得|注意|以后|永远|始终|不要|禁止|避免|务必))\s*[:：]?\s*(.+)/gi,
    type: 'instruction',
    keyExtractor: (_match) => 'user_instruction',
    valueExtractor: (match) => match[1]?.trim() ?? '',
    confidence: 0.5,
  },
  {
    pattern: /(?:我(?:的)?名(?:字|称)(?:是|叫))\s*[:：]?\s*(\S+)/gi,
    type: 'fact',
    keyExtractor: (_match) => 'user_name',
    valueExtractor: (match) => match[1]?.trim() ?? '',
    confidence: 0.8,
  },
  {
    pattern: /(?:我(?:在|的公司是))\s*[:：]?\s*(\S+)\s*(?:工作|公司|上班)/gi,
    type: 'fact',
    keyExtractor: (_match) => 'company',
    valueExtractor: (match) => match[1]?.trim() ?? '',
    confidence: 0.7,
  },
  {
    pattern: /(?:这个项目(?:叫|名称是|叫做))\s*[:：]?\s*(.+)/gi,
    type: 'project_context',
    keyExtractor: (_match) => 'project_name',
    valueExtractor: (match) => match[1]?.trim() ?? '',
    confidence: 0.7,
  },
  {
    pattern: /(?:(?:I |my )(?:prefer|like|always use|usually|tend to))\s*[:：]?\s*(.+)/gi,
    type: 'preference',
    keyExtractor: (_match) => 'user_preference',
    valueExtractor: (match) => match[1]?.trim() ?? '',
    confidence: 0.6,
  },
  {
    pattern: /(?:(?:always|never|don't|do not|please remember|remember that))\s+(.+)/gi,
    type: 'instruction',
    keyExtractor: (_match) => 'user_instruction',
    valueExtractor: (match) => match[0]?.trim() ?? '',
    confidence: 0.5,
  },
  {
    pattern: /(?:my name is)\s+(\S+)/gi,
    type: 'fact',
    keyExtractor: (_match) => 'user_name',
    valueExtractor: (match) => match[1]?.trim() ?? '',
    confidence: 0.8,
  },
];

function makeKeyUnique(baseKey: string, index: number): string {
  return index === 0 ? baseKey : `${baseKey}_${index}`;
}

export function extractMemoriesFromText(text: string): ExtractedMemoryCandidate[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const candidates: ExtractedMemoryCandidate[] = [];
  const seenValues = new Set<string>();

  for (const pattern of EXTRACTION_PATTERNS) {
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
    let match: RegExpExecArray | null;
    let matchIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      const value = pattern.valueExtractor(match);
      if (!value || value.length < 2 || value.length > 500) {
        continue;
      }

      const normalizedValue = value.toLowerCase().trim();
      if (seenValues.has(normalizedValue)) {
        continue;
      }
      seenValues.add(normalizedValue);

      candidates.push({
        type: pattern.type,
        key: makeKeyUnique(pattern.keyExtractor(match), matchIndex),
        value,
        confidence: pattern.confidence,
      });
      matchIndex += 1;
    }
  }

  return candidates;
}
