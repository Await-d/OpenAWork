export type ArtifactType = 'text' | 'code' | 'image' | 'file';

export interface Artifact {
  id: string;
  name: string;
  type: ArtifactType;
  content?: string;
  url?: string;
  size?: number;
  sessionId: string;
  createdAt: number;
}

export interface ArtifactManagerInterface {
  register(artifact: Omit<Artifact, 'id' | 'createdAt'>): Artifact;
  list(sessionId?: string): Artifact[];
  get(id: string): Artifact | undefined;
  share(id: string): string;
  download(id: string): string;
  export(id: string): string;
  remove(id: string): boolean;
}

function generateId(): string {
  return `art_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class ArtifactManager implements ArtifactManagerInterface {
  private store = new Map<string, Artifact>();

  register(artifact: Omit<Artifact, 'id' | 'createdAt'>): Artifact {
    const id = generateId();
    const full: Artifact = {
      ...artifact,
      id,
      createdAt: Date.now(),
    };
    this.store.set(id, full);
    return full;
  }

  list(sessionId?: string): Artifact[] {
    const all = [...this.store.values()];
    if (sessionId === undefined) return all;
    return all.filter((a) => a.sessionId === sessionId);
  }

  get(id: string): Artifact | undefined {
    return this.store.get(id);
  }

  share(id: string): string {
    const artifact = this.store.get(id);
    if (!artifact) throw new Error(`Artifact not found: ${id}`);
    return `https://openwork.app/share/${id}`;
  }

  download(id: string): string {
    const artifact = this.store.get(id);
    if (!artifact) throw new Error(`Artifact not found: ${id}`);
    return `https://openwork.app/download/${id}/${encodeURIComponent(artifact.name)}`;
  }

  export(id: string): string {
    const artifact = this.store.get(id);
    if (!artifact) throw new Error(`Artifact not found: ${id}`);
    return JSON.stringify(artifact, null, 2);
  }

  remove(id: string): boolean {
    return this.store.delete(id);
  }
}
