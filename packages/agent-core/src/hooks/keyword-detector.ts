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
}

export interface KeywordDetector {
  detect(input: string): KeywordDetectionResult;
  configure(config: Partial<KeywordDetectorConfig>): void;
  getConfig(): KeywordDetectorConfig;
}

const DEFAULT_CONFIG: KeywordDetectorConfig = {
  ultraworkKeywords: ['ultrawork', 'ulw', '极限模式'],
  searchKeywords: ['search', 'find', '搜索', '查找'],
  analyzeKeywords: ['analyze', 'investigate', '分析', '研究'],
};

export class KeywordDetectorImpl implements KeywordDetector {
  private config: KeywordDetectorConfig = { ...DEFAULT_CONFIG };

  detect(input: string): KeywordDetectionResult {
    const lower = input.toLowerCase();

    for (const kw of this.config.ultraworkKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { mode: 'ultrawork', matchedKeyword: kw, confidence: 1 };
      }
    }
    for (const kw of this.config.searchKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { mode: 'search', matchedKeyword: kw, confidence: 1 };
      }
    }
    for (const kw of this.config.analyzeKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { mode: 'analyze', matchedKeyword: kw, confidence: 1 };
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
