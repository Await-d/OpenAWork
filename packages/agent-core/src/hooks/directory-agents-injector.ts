import fs from 'fs/promises';
import path from 'path';

export interface AgentsContextEntry {
  filePath: string;
  content: string;
  depth: number;
}

export interface DirectoryAgentsInjector {
  findNearestAgentsFile(filePath: string, stopAt?: string): Promise<AgentsContextEntry | null>;
  collectAllAgentsFiles(filePath: string, stopAt?: string): Promise<AgentsContextEntry[]>;
  buildInjectionBlock(entries: AgentsContextEntry[]): string;
}

export class DirectoryAgentsInjectorImpl implements DirectoryAgentsInjector {
  private readonly agentsFileNames = ['AGENTS.md', 'CRUSH.md', 'CLAUDE.md', 'GEMINI.md'];

  async findNearestAgentsFile(
    filePath: string,
    stopAt?: string,
  ): Promise<AgentsContextEntry | null> {
    let currentDir = path.dirname(path.resolve(filePath));
    const stopDir = stopAt ? path.resolve(stopAt) : path.parse(currentDir).root;
    let depth = 0;

    while (true) {
      for (const fileName of this.agentsFileNames) {
        const candidate = path.join(currentDir, fileName);
        if (await this.fileExists(candidate)) {
          const content = await fs.readFile(candidate, 'utf8');
          return { filePath: candidate, content, depth };
        }
      }

      if (currentDir === stopDir) return null;
      const parent = path.dirname(currentDir);
      if (parent === currentDir) return null;
      currentDir = parent;
      depth += 1;
    }
  }

  async collectAllAgentsFiles(filePath: string, stopAt?: string): Promise<AgentsContextEntry[]> {
    let currentDir = path.dirname(path.resolve(filePath));
    const stopDir = stopAt ? path.resolve(stopAt) : path.parse(currentDir).root;
    let depth = 0;
    const entries: AgentsContextEntry[] = [];

    while (true) {
      for (const fileName of this.agentsFileNames) {
        const candidate = path.join(currentDir, fileName);
        if (await this.fileExists(candidate)) {
          const content = await fs.readFile(candidate, 'utf8');
          entries.push({ filePath: candidate, content, depth });
        }
      }

      if (currentDir === stopDir) break;
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
      depth += 1;
    }

    return entries.sort((a, b) => a.depth - b.depth);
  }

  buildInjectionBlock(entries: AgentsContextEntry[]): string {
    if (entries.length === 0) return '';
    return entries
      .map((entry) => `Instructions from: ${entry.filePath}\n${entry.content}`)
      .join('\n\n');
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
