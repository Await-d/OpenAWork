export type AuthorizationLayer = 'root' | 'session';

export interface AuthorizedFolder {
  path: string;
  layer: AuthorizationLayer;
  authorizedAt: number;
}

export class FolderAuthorizationManager {
  private rootFolders: Map<string, AuthorizedFolder> = new Map();
  private sessionFolders: Map<string, AuthorizedFolder> = new Map();

  authorizeRoot(path: string): void {
    const normalized = this.normalizePath(path);
    this.rootFolders.set(normalized, {
      path: normalized,
      layer: 'root',
      authorizedAt: Date.now(),
    });
  }

  authorizeSubdir(path: string): void {
    const normalized = this.normalizePath(path);
    this.sessionFolders.set(normalized, {
      path: normalized,
      layer: 'session',
      authorizedAt: Date.now(),
    });
  }

  isAuthorized(path: string): boolean {
    const normalized = this.normalizePath(path);
    return (
      this.matchesAny(normalized, this.rootFolders) ||
      this.matchesAny(normalized, this.sessionFolders)
    );
  }

  listAuthorized(): AuthorizedFolder[] {
    return [...Array.from(this.rootFolders.values()), ...Array.from(this.sessionFolders.values())];
  }

  revoke(path: string, layer: AuthorizationLayer): void {
    const normalized = this.normalizePath(path);
    if (layer === 'root') {
      this.rootFolders.delete(normalized);
    } else {
      this.sessionFolders.delete(normalized);
    }
  }

  clearSessionAuthorizations(): void {
    this.sessionFolders.clear();
  }

  private normalizePath(path: string): string {
    return path.endsWith('/') ? path.slice(0, -1) : path;
  }

  private matchesAny(targetPath: string, store: Map<string, AuthorizedFolder>): boolean {
    for (const authorizedPath of store.keys()) {
      if (targetPath === authorizedPath || targetPath.startsWith(authorizedPath + '/')) {
        return true;
      }
    }
    return false;
  }
}
