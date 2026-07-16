import type { WorkspaceClient } from '@openAwork/web-client';
import { getFilePreviewKind } from './file-preview.js';

export interface LoadedPreviewContent {
  readonly content: string;
  readonly dispose: () => void;
}

interface LoadPreviewContentArgs {
  readonly client: WorkspaceClient;
  readonly token: string;
  readonly path: string;
  readonly workspaceRoot?: string | null;
}

const NOOP_DISPOSE = (): void => undefined;

function buildReadOptions(workspaceRoot?: string | null): { workspaceRoot?: string } {
  if (workspaceRoot && workspaceRoot.trim().length > 0) {
    return { workspaceRoot };
  }
  return {};
}

export async function loadPreviewContent(
  args: LoadPreviewContentArgs,
): Promise<LoadedPreviewContent> {
  const readOptions = buildReadOptions(args.workspaceRoot);
  if (getFilePreviewKind(args.path) === 'image') {
    const data = await args.client.readFileBinary(args.token, args.path, readOptions);
    const objectUrl = URL.createObjectURL(new Blob([data.buffer], { type: data.contentType }));
    return {
      content: objectUrl,
      dispose: () => {
        URL.revokeObjectURL(objectUrl);
      },
    };
  }

  const data = await args.client.readFile(args.token, args.path, readOptions);
  return {
    content: data.content ?? '',
    dispose: NOOP_DISPOSE,
  };
}
