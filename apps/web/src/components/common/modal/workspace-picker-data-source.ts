import type {
  FileTreeNode,
  WorkspaceClient,
  WorkspaceValidateResult,
} from '@openAwork/web-client';

export interface WorkspacePickerDataSource {
  fetchRootPath: () => Promise<string>;
  fetchTree: (path: string, depth?: number) => Promise<FileTreeNode[]>;
  fetchWorkspaceRoots: () => Promise<string[]>;
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
    fetchTree: async (path: string, depth = 1): Promise<FileTreeNode[]> => {
      const result = await input.client.fetchTreeResult(requireToken(), path, { depth });
      if (!result.ok) {
        throw new Error(result.errorMessage ?? WORKSPACE_PICKER_TREE_LOAD_FAILED_MESSAGE);
      }
      return result.nodes;
    },
    validatePath: async (path: string): Promise<WorkspaceValidateResult> => {
      if (!input.token) {
        return { valid: false, error: '未登录，无法校验路径。' };
      }
      return input.client.validatePath(input.token, path);
    },
  };
}
