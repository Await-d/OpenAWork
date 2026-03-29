import type { RunArtifact } from '@openAwork/artifacts';

type ArtifactPlatformAdapter = {
  openPath: (path: string) => Promise<void>;
  shareArtifact: (artifact: RunArtifact) => Promise<string>;
};

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = (
    window as Window & {
      __TAURI__?: { core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<T> } };
    }
  ).__TAURI__;
  if (!tauri) {
    throw new Error('Not running in Tauri');
  }
  return tauri.core.invoke(cmd, args);
}

export function createDesktopArtifactPlatformAdapter(): ArtifactPlatformAdapter {
  return {
    async openPath(path: string): Promise<void> {
      await tauriInvoke('open_artifact_path', { path });
    },
    async shareArtifact(artifact: RunArtifact): Promise<string> {
      return artifact.path ?? `artifact://${artifact.id}`;
    },
  };
}
