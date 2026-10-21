export type ArtifactType = 'file_created' | 'file_modified' | 'document' | 'log' | 'summary';
export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface RunArtifact {
  id: string;
  sessionId: string;
  type: ArtifactType;
  name: string;
  path?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: number;
  preview?: string;
}

export interface ArtifactPlatformAdapter {
  openPath: (path: string) => Promise<void>;
  shareArtifact: (artifact: RunArtifact) => Promise<string>;
}

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  oldPath?: string;
  linesAdded?: number;
  linesDeleted?: number;
  diffSnippet?: string;
}

export interface FileSearchResult {
  path: string;
  line?: number;
  column?: number;
  snippet?: string;
}

export interface SymbolResult {
  name: string;
  kind: string;
  path: string;
  line: number;
}

export interface ArtifactManager {
  list(sessionId: string): Promise<RunArtifact[]>;
  add(artifact: Omit<RunArtifact, 'id' | 'createdAt'>): RunArtifact;
  /** 按 id 精确查询；不存在时返回 undefined（不抛错）。 */
  get(artifactId: string): RunArtifact | undefined;
  /**
   * 删除索引条目并尽力删除其磁盘文件。
   *
   * 返回是否确实存在过该条目：文件删除失败（权限、已被手工清理）不影响索引一致性，
   * 只记警告——否则调用方会因为「文件删不掉」而误判条目还在，进而放弃队列清理。
   */
  remove(artifactId: string): boolean;
  /**
   * 批量删除（单次索引落盘）。
   *
   * `remove` 每删一条都会把整个索引重写一遍——清理一批（如待发队列清空、会话删除）
   * 时逐个调用会退化成 O(n²) 的写放大。批量入口只落盘一次，语义与逐条 `remove` 相同：
   * 返回实际删掉的条数，磁盘文件仍按条 best-effort 处理。
   */
  removeMany(artifactIds: Iterable<string>): number;
  open(artifactId: string): Promise<void>;
  download(artifactId: string, dest: string): Promise<void>;
  share(artifactId: string): Promise<string>;
  exportAll(sessionId: string): Promise<string>;
}

export interface FileBrowserAPI {
  getChanges(sessionId: string): Promise<FileChange[]>;
  recordChange(sessionId: string, change: FileChange): void;
  searchText(query: string, options?: { maxResults?: number }): Promise<FileSearchResult[]>;
  searchFiles(pattern: string): Promise<string[]>;
  read(path: string): Promise<{ content: string; encoding: string }>;
}
