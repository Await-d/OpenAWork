import type {
  FileTreeNode,
  WorkspaceClient,
  WorkspaceFileReadOptions,
  WorkspaceTreeReadOptions,
  WorkspaceValidateResult,
} from '@openAwork/web-client';

export interface WorkspacePickerDataSource {
  fetchRootPath: () => Promise<string>;
  /**
   * 读取目录树。
   *
   * `readOptions` 用于 SSH 远程工作区：会话身份 / 连接身份 / 远端根由调用方传入，
   * 缺省时是纯本地读取，请求参数与改动前逐字节一致。
   */
  fetchTree: (
    path: string,
    depth?: number,
    readOptions?: WorkspaceFileReadOptions,
  ) => Promise<FileTreeNode[]>;
  fetchWorkspaceRoots: () => Promise<string[]>;
  createDirectory: (path: string) => Promise<void>;
  validatePath: (path: string) => Promise<WorkspaceValidateResult>;
}

const WORKSPACE_PICKER_AUTH_REQUIRED_MESSAGE = '未登录，无法读取工作区目录。';
const WORKSPACE_PICKER_NO_ROOTS_MESSAGE = '当前账号下没有可用工作区根目录。';
const WORKSPACE_PICKER_TREE_LOAD_FAILED_MESSAGE = '读取文件树失败。';

export function buildWorkspacePickerDataSource(input: {
  client: WorkspaceClient;
  token: string | null | undefined;
}): WorkspacePickerDataSource {
  const requireToken = (): string => {
    if (!input.token) {
      throw new Error(WORKSPACE_PICKER_AUTH_REQUIRED_MESSAGE);
    }
    return input.token;
  };

  const fetchWorkspaceRoots = async (): Promise<string[]> => {
    const result = await input.client.listRootsResult(requireToken());
    if (!result.ok) {
      throw new Error(result.errorMessage ?? '读取工作区根目录失败。');
    }
    if (result.roots.length === 0) {
      throw new Error(WORKSPACE_PICKER_NO_ROOTS_MESSAGE);
    }
    return result.roots;
  };

  return {
    fetchWorkspaceRoots,
    fetchRootPath: async (): Promise<string> => {
      const roots = await fetchWorkspaceRoots();
      const root = roots[0];
      if (!root) {
        throw new Error(WORKSPACE_PICKER_NO_ROOTS_MESSAGE);
      }
      return root;
    },
    fetchTree: async (
      path: string,
      depth = 1,
      readOptions?: WorkspaceFileReadOptions,
    ): Promise<FileTreeNode[]> => {
      // depth 以位置参数为准：调用方显式传的第二参优先于身份参数里的同名字段。
      const options: WorkspaceTreeReadOptions = { ...(readOptions ?? {}), depth };
      const result = await input.client.fetchTreeResult(requireToken(), path, options);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? WORKSPACE_PICKER_TREE_LOAD_FAILED_MESSAGE);
      }
      return result.nodes;
    },
    createDirectory: async (path: string): Promise<void> => {
      await input.client.createDirectory(requireToken(), path);
    },
    validatePath: async (path: string): Promise<WorkspaceValidateResult> => {
      if (!input.token) {
        return { valid: false, error: '未登录，无法校验路径。' };
      }
      return input.client.validatePath(input.token, path);
    },
  };
}
