import { hasSystemReminder, isSystemDirective, removeSystemReminders } from './system-directive.js';

export type ActivationMode = 'ultrawork' | 'search' | 'analyze' | 'normal';

export interface KeywordDetectorConfig {
  ultraworkKeywords: string[];
  searchKeywords: string[];
  analyzeKeywords: string[];
}

export interface KeywordDetectionResult {
  mode: ActivationMode;
  matchedKeyword?: string;
  confidence: number;
  injectedPrompt?: string;
}

export interface KeywordDetector {
  detect(input: string): KeywordDetectionResult;
  configure(config: Partial<KeywordDetectorConfig>): void;
  getConfig(): KeywordDetectorConfig;
}

const DEFAULT_CONFIG: KeywordDetectorConfig = {
  ultraworkKeywords: ['ultrawork', 'ulw', '极限模式'],
  searchKeywords: ['search', 'find', '搜索', '查找'],
  analyzeKeywords: [
    'analyze',
    'analyse',
    'investigate',
    'research',
    'audit',
    'diagnose',
    'review',
    'debug',
    'why is',
    'how does',
    'how to',
    '分析',
    '研究',
    '调查',
    '检查',
    '为什么',
    '原理',
    '诊断',
  ],
};

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

export const ANALYZE_MODE_MESSAGE = `[analyze-mode]
ANALYSIS MODE. Gather context before diving deep:

CONTEXT GATHERING (parallel):
- 1-2 explore agents (codebase patterns, implementations)
- 1-2 librarian agents (if external library involved)
- Direct tools: Grep, AST-grep, LSP for targeted searches

IF COMPLEX - DO NOT STRUGGLE ALONE. Consult specialists:
- **Oracle**: Conventional problems (architecture, debugging, complex logic)
- **Artistry**: Non-conventional problems (different approach needed)

SYNTHESIZE findings before proceeding.
---
MANDATORY delegate_task params: ALWAYS include load_skills=[] and run_in_background when calling delegate_task.`;

export const SEARCH_MODE_MESSAGE = `[search-mode]
SEARCH MODE. Prioritize current documentation, real implementations, and authoritative references before answering or modifying code.`;

export const ULTRAWORK_MODE_MESSAGE = `ULTRAWORK MODE ENABLED!

[CODE RED] Maximum precision required. Ultrathink before acting.

MANDATORY:
- Explore first, implement after certainty
- Delegate aggressively for non-trivial work
- Do not ship partial work
- Re-check the original request before declaring done`;

function stripCodeBlocks(input: string): string {
  return input.replace(CODE_BLOCK_PATTERN, ' ').replace(INLINE_CODE_PATTERN, ' ');
}

export class KeywordDetectorImpl implements KeywordDetector {
  private config: KeywordDetectorConfig = { ...DEFAULT_CONFIG };

  detect(input: string): KeywordDetectionResult {
    const cleaned = hasSystemReminder(input) ? removeSystemReminders(input) : input;
    if (isSystemDirective(cleaned)) {
      return { mode: 'normal', confidence: 0 };
    }
    const lower = stripCodeBlocks(cleaned).toLowerCase();

    for (const kw of this.config.ultraworkKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return {
          mode: 'ultrawork',
          matchedKeyword: kw,
          confidence: 1,
          injectedPrompt: ULTRAWORK_MODE_MESSAGE,
        };
      }
    }
    for (const kw of this.config.searchKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return {
          mode: 'search',
          matchedKeyword: kw,
          confidence: 1,
          injectedPrompt: SEARCH_MODE_MESSAGE,
        };
      }
    }
    for (const kw of this.config.analyzeKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return {
          mode: 'analyze',
          matchedKeyword: kw,
          confidence: 1,
          injectedPrompt: ANALYZE_MODE_MESSAGE,
        };
      }
    }

    return { mode: 'normal', confidence: 0 };
  }

  configure(config: Partial<KeywordDetectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): KeywordDetectorConfig {
    return { ...this.config };
  }
}
