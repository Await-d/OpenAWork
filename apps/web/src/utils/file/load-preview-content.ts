import type { WorkspaceClient, WorkspaceFileReadOptions } from '@openAwork/web-client';
import type { WorkspaceReadIdentity } from '../../stores/ui/uiState.js';
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
  /**
   * 工作区读取身份（SSH 会话 / 草稿远程工作区）。为空即本地工作区，
   * 请求参数与改动前逐字节一致。
   */
  readonly identity?: WorkspaceReadIdentity | null;
}

const NOOP_DISPOSE = (): void => undefined;

function buildReadOptions(
  workspaceRoot?: string | null,
  identity?: WorkspaceReadIdentity | null,
): WorkspaceFileReadOptions {
  const options: WorkspaceFileReadOptions = {};
  if (workspaceRoot && workspaceRoot.trim().length > 0) {
    options.workspaceRoot = workspaceRoot;
  }
  // SSH 远端身份：已有会话传 sessionId（网关沿父会话链解析连接），草稿态传
  // sshConnectionId。二者皆无时不追加任何查询参数，本地读取路径保持不变。
  if (identity?.sessionId) {
    options.sessionId = identity.sessionId;
  } else if (identity?.sshConnectionId) {
    options.sshConnectionId = identity.sshConnectionId;
  }
  return options;
}

export async function loadPreviewContent(
  args: LoadPreviewContentArgs,
): Promise<LoadedPreviewContent> {
  const readOptions = buildReadOptions(args.workspaceRoot, args.identity);
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
