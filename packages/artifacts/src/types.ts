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
