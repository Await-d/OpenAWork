/**
 * 遍历工作区时按 basename 命中的跳过集合（VCS / 依赖 / 构建 / 工具状态）。
 *
 * 这里区分两个集合，而不是一份「合并大名单」，因为两个消费方的语义不同：
 *
 * - {@link WORKSPACE_CORE_IGNORED_DIRS}：**agent 文件遍历工具**（`list` / `tree`
 *   / `glob` / `grep`）的既有 denylist，只含 VCS 元数据与依赖/虚拟环境目录。
 *   这份集合一旦增长，就会让 agent 看不到某些真实目录（例如 `build/`、`out/`、
 *   `temp/` 里可能存着可读产物或提交过的源码），因此**只做常量收敛，不放宽或
 *   收紧语义**。
 * - {@link WORKSPACE_FILE_INDEX_IGNORED_DIRS}：工作区文件索引（`@` 文件提及）
 *   的剪枝集合，在 core 之上额外剪掉构建产物与工具状态目录——提及菜单里出现
 *   `.codegraph/*.log`、`temp/*` 之类条目没有意义。
 *
 * 叶子模块，零导入：文件索引及其测试必须在没有 db / env 的情况下仍可加载。
 * 真正的 `.gitignore` / agentignore 语义由 `AgentIgnoreManager` 按工作区根处理，
 * 这里只处理与具体项目无关的通用状态目录；committed 源码目录（如 `bin`、`obj`）
 * 绝不进入任一集合。
 */

/** agent 文件遍历工具的 denylist：仅 VCS 元数据与依赖目录，语义不得变更。 */
export const WORKSPACE_CORE_IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.DS_Store',
  '.vs',
  '.idea',
  '.omo',
  '.venv',
  'target',
  'coverage',
]);

/** 文件索引剪枝集合：core 之外再剪掉构建产物与工具状态目录。 */
export const WORKSPACE_FILE_INDEX_IGNORED_DIRS: ReadonlySet<string> = new Set([
  ...WORKSPACE_CORE_IGNORED_DIRS,
  '.hg',
  '.svn',
  'build',
  'out',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.nx',
  'venv',
  '.pnpm-store',
  '.yarn',
  '.vscode',
  '.codegraph',
  '.claude',
  '.husky',
  'temp',
  '.sisyphus',
]);
