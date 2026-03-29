import { Linking, Share } from 'react-native';
import type { RunArtifact } from '@openAwork/artifacts';

type ArtifactPlatformAdapter = {
  openPath: (path: string) => Promise<void>;
  shareArtifact: (artifact: RunArtifact) => Promise<string>;
};

export function createMobileArtifactPlatformAdapter(): ArtifactPlatformAdapter {
  return {
    async openPath(path: string): Promise<void> {
      if (/^https?:\/\//.test(path)) {
        await Linking.openURL(path);
        return;
      }
      await Share.share({ message: path });
    },
    async shareArtifact(artifact: RunArtifact): Promise<string> {
      const shareTarget = artifact.path ?? artifact.id;
      await Share.share({ message: shareTarget });
      return shareTarget;
    },
  };
}
