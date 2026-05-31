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
      throw new Error('当前 Web 环境不支持直接打开本地文件路径。');
    },
    async shareArtifact(artifact: RunArtifact): Promise<string> {
      const shareTarget = artifact.path ?? artifact.id;
      await navigator.clipboard.writeText(shareTarget);
      return shareTarget;
    },
  };
}
