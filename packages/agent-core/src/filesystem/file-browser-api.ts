export interface TextSearchOptions {
  caseSensitive?: boolean;
  filePattern?: string;
}

export interface TextSearchResult {
  filePath: string;
  line: number;
  column: number;
  matchText: string;
  context: string;
}

export interface SymbolSearchResult {
  filePath: string;
  symbolName: string;
  kind: string;
  line: number;
}

export interface FileContent {
  path: string;
  content: string;
  encoding: string;
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  oldPath?: string;
  linesAdded?: number;
  linesDeleted?: number;
}

export interface FileBrowserAPI {
  searchText(
    query: string,
    rootPath: string,
    options?: TextSearchOptions,
  ): Promise<TextSearchResult[]>;
  searchFiles(namePattern: string, rootPath: string): Promise<string[]>;
  searchSymbols(query: string, rootPath: string): Promise<SymbolSearchResult[]>;
  read(path: string): Promise<FileContent>;
  status(): Promise<FileChange[]>;
}

type ExecFn = (cmd: string, opts?: { maxBuffer?: number }) => Promise<{ stdout: string }>;

async function getExec(): Promise<ExecFn> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  return promisify(exec) as unknown as ExecFn;
}

export class FileBrowserAPIImpl implements FileBrowserAPI {
  async searchText(
    query: string,
    rootPath: string,
    options?: TextSearchOptions,
  ): Promise<TextSearchResult[]> {
    const execAsync = await getExec();
    const caseFlag = options?.caseSensitive ? '' : '-i';
    const includeFlag = options?.filePattern ? `--include='${options.filePattern}'` : '';
    const cmd = `grep -rn ${caseFlag} ${includeFlag} --color=never -F ${JSON.stringify(query)} ${JSON.stringify(rootPath)} 2>/dev/null || true`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 4 * 1024 * 1024 });
    const results: TextSearchResult[] = [];
    for (const raw of stdout.split('\n')) {
      const m = raw.match(/^([^:]+):([0-9]+):(.*)$/);
      if (!m) continue;
      const [, filePath, lineStr, matchText] = m;
      if (!filePath || !lineStr || matchText === undefined) continue;
      const col = matchText.indexOf(query);
      results.push({
        filePath,
        line: parseInt(lineStr, 10),
        column: col < 0 ? 0 : col,
        matchText: matchText.trim(),
        context: matchText.trim(),
      });
    }
    return results;
  }

  async searchFiles(namePattern: string, rootPath: string): Promise<string[]> {
    const execAsync = await getExec();
    const cmd = `find ${JSON.stringify(rootPath)} -type f -name ${JSON.stringify(namePattern)} 2>/dev/null || true`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 2 * 1024 * 1024 });
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async searchSymbols(query: string, rootPath: string): Promise<SymbolSearchResult[]> {
    const execAsync = await getExec();
    const kinds = ['class', 'interface', 'function', 'const', 'type'];
    const results: SymbolSearchResult[] = [];
    for (const kind of kinds) {
      const pattern = `${kind} ${query}`;
      const cmd = `grep -rn --color=never -F ${JSON.stringify(pattern)} ${JSON.stringify(rootPath)} 2>/dev/null || true`;
      const { stdout } = await execAsync(cmd, { maxBuffer: 2 * 1024 * 1024 });
      for (const raw of stdout.split('\n')) {
        const m = raw.match(/^([^:]+):([0-9]+):/);
        if (!m) continue;
        const [, filePath, lineStr] = m;
        if (!filePath || !lineStr) continue;
        results.push({ filePath, symbolName: query, kind, line: parseInt(lineStr, 10) });
      }
    }
    return results;
  }

  async read(path: string): Promise<FileContent> {
    const { promises: fsp } = await import('node:fs');
    const content = await fsp.readFile(path, 'utf-8');
    return { path, content, encoding: 'utf-8' };
  }

  async status(): Promise<FileChange[]> {
    try {
      const execAsync = await getExec();
      const { stdout } = await execAsync('git status --porcelain -u 2>/dev/null || true', {
        maxBuffer: 1024 * 1024,
      });
      const changes: FileChange[] = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const code = line.substring(0, 2);
        const rest = line.substring(3);
        let status: FileChangeStatus = 'modified';
        let filePath = rest.trim();
        let oldPath: string | undefined;
        if (code.includes('A')) status = 'added';
        else if (code.includes('D')) status = 'deleted';
        else if (code.includes('R')) {
          status = 'renamed';
          const parts = rest.split(' -> ');
          oldPath = parts[0]?.trim();
          filePath = parts[1]?.trim() ?? filePath;
        }
        changes.push({ path: filePath, status, oldPath });
      }
      return changes;
    } catch {
      return [];
    }
  }
}

export const fileBrowserAPI: FileBrowserAPI = new FileBrowserAPIImpl();
