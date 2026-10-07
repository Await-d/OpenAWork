import type { WorkspaceClient } from '@openAwork/web-client';
import type { WorkspaceReadIdentity } from '../../stores/ui/uiState.js';
import { getFilePreviewKind } from './file-preview.js';
import { buildPreviewReadAttempts, runWithReadIdentityFallback } from './preview-read-identity.js';

export interface LoadedPreviewContent {
  readonly content: string;
  readonly dispose: () => void;
  /**
   * 服务端是否因超过预览上限截断了内容。
   *
   * 网关现在对超限文件统一返回 413（不再截断），因此该字段在正常链路上恒为
   * `false`，仅作为协议兼容与防御性兜底保留：为 `true` 时 `content` 只是源文件
   * 前缀，调用方必须禁止写回（见 `useFileEditor` 的 `saveFile`），否则一次普通
   * 保存就会把源文件永久截短。
   */
  readonly truncated?: boolean;
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

export async function loadPreviewContent(
  args: LoadPreviewContentArgs,
): Promise<LoadedPreviewContent> {
  // 网关解析身份时 sessionId 独占优先，会话 SSH 绑定失效时会把远端 POSIX
  // 路径误判成跨主机路径而 400；因此按候选身份顺序试读，见 preview-read-identity.ts。
  const attempts = buildPreviewReadAttempts(args.workspaceRoot, args.identity);

  if (getFilePreviewKind(args.path) === 'image') {
    const data = await runWithReadIdentityFallback(attempts, (options) =>
      args.client.readFileBinary(args.token, args.path, options),
    );
    const objectUrl = URL.createObjectURL(new Blob([data.buffer], { type: data.contentType }));
    return {
      content: objectUrl,
      dispose: () => {
        URL.revokeObjectURL(objectUrl);
      },
    };
  }

  const data = await runWithReadIdentityFallback(attempts, (options) =>
    args.client.readFile(args.token, args.path, options),
  );
  return {
    content: data.content ?? '',
    dispose: NOOP_DISPOSE,
    ...(data.truncated ? { truncated: true } : {}),
  };
}
