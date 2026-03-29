export interface CrushIgnoreManager {
  loadPatterns(projectRoot: string): Promise<string[]>;
  shouldIgnore(filePath: string, patterns: string[]): boolean;
  mergeWithAgentIgnore(crushPatterns: string[], agentPatterns: string[]): string[];
}

export class CrushIgnoreManagerImpl implements CrushIgnoreManager {
  async loadPatterns(projectRoot: string): Promise<string[]> {
    try {
      const { promises: fs } = await import('node:fs');
      const { join } = await import('node:path');
      const content = await fs.readFile(join(projectRoot, '.crushignore'), 'utf-8');
      return content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
    } catch {
      return [];
    }
  }

  shouldIgnore(filePath: string, patterns: string[]): boolean {
    return patterns.some((p) => filePath.includes(p.replace(/\*/g, '')));
  }

  mergeWithAgentIgnore(crushPatterns: string[], agentPatterns: string[]): string[] {
    return Array.from(new Set([...crushPatterns, ...agentPatterns]));
  }
}
