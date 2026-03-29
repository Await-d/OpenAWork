import type { RunArtifact } from '@openAwork/artifacts';

type ArtifactPlatformAdapter = {
  openPath: (path: string) => Promise<void>;
  shareArtifact: (artifact: RunArtifact) => Promise<string>;
};

export function createWebArtifactPlatformAdapter(): ArtifactPlatformAdapter {
  return {
    async openPath(path: string): Promise<void> {
      if (/^https?:\/\//.test(path)) {
        window.open(path, '_blank', 'noopener,noreferrer');
        return;
      }
      throw new Error('Web artifact adapter cannot open local file paths directly');
    },
    async shareArtifact(artifact: RunArtifact): Promise<string> {
      const shareTarget = artifact.path ?? artifact.id;
      await navigator.clipboard.writeText(shareTarget);
      return shareTarget;
    },
  };
}
