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

/**
 * Wall-clock ceiling for a single search subprocess. grep/find over a huge or
 * network-mounted tree can run unbounded; without a deadline the returned
 * promise never settles and the caller awaiting a search hangs forever.
 */
const SEARCH_TIMEOUT_MS = 15_000;

type ExecFileFn = (
  file: string,
  args: string[],
  opts?: { maxBuffer?: number; timeout?: number },
) => Promise<{ stdout: string }>;

async function getExecFile(): Promise<ExecFileFn> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  return promisify(execFile) as unknown as ExecFileFn;
}

/**
 * Run a search command via execFile (no shell, so query/path/pattern can never
 * be interpreted as shell metacharacters) and return stdout. grep exits 1 when
 * there are no matches and find/git may exit non-zero on partial errors; the
 * original shell form swallowed those with `2>/dev/null || true`, so we mirror
 * that by returning whatever stdout was captured instead of throwing.
 */
async function runSearch(file: string, args: string[], maxBuffer: number): Promise<string> {
  const execFileAsync = await getExecFile();
  try {
    const { stdout } = await execFileAsync(file, args, {
      maxBuffer,
      timeout: SEARCH_TIMEOUT_MS,
    });
    return stdout;
  } catch (error) {
    // Non-zero exit (grep "no match", find permission warnings) carries the
    // partial stdout on the error object; surface it rather than failing.
    const stdout = (error as { stdout?: string | Buffer })?.stdout;
    if (typeof stdout === 'string') return stdout;
    if (stdout) return stdout.toString();
    return '';
  }
}

export class FileBrowserAPIImpl implements FileBrowserAPI {
  async searchText(
    query: string,
    rootPath: string,
    options?: TextSearchOptions,
  ): Promise<TextSearchResult[]> {
    const args = ['-rn', '--color=never'];
    if (!options?.caseSensitive) args.push('-i');
    if (options?.filePattern) args.push(`--include=${options.filePattern}`);
    args.push('-F', query, rootPath);
    const stdout = await runSearch('grep', args, 4 * 1024 * 1024);
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
    const stdout = await runSearch(
      'find',
      [rootPath, '-type', 'f', '-name', namePattern],
      2 * 1024 * 1024,
    );
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async searchSymbols(query: string, rootPath: string): Promise<SymbolSearchResult[]> {
    const kinds = ['class', 'interface', 'function', 'const', 'type'];
    const results: SymbolSearchResult[] = [];
    for (const kind of kinds) {
      const pattern = `${kind} ${query}`;
      const stdout = await runSearch(
        'grep',
        ['-rn', '--color=never', '-F', pattern, rootPath],
        2 * 1024 * 1024,
      );
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
      const stdout = await runSearch('git', ['status', '--porcelain', '-u'], 1024 * 1024);
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
