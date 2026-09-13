/**
 * 输入框「上传文件」选择器的类型引导。
 *
 * 两条边界需要说清楚：
 * - 网关的 `/sessions/:id/artifacts` 只校验 `name` / `contentBase64` 非空，不做类型白名单；
 * - 拖拽上传（`onDropFiles`）同样不经过这个列表。
 *
 * 因此该列表只影响文件对话框的默认过滤，既不是安全边界，也不应过窄——过窄的
 * 直接后果是用户在对话框里看不到自己要传的文件。原先的取值遗漏了 `audio/*`、
 * `video/*` 与全部文档类型，而 `inferMimeTypeFromFileName` 和 `AttachmentItem`
 * 都明确支持音视频，属于声明与实际能力不一致。
 */
const MEDIA_TYPES = ['image/*', 'audio/*', 'video/*'] as const;

const TEXT_AND_CONFIG_EXTENSIONS = [
  '.md',
  '.mdx',
  '.txt',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.xml',
  '.env',
] as const;

const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'] as const;

const FRONTEND_EXTENSIONS = [
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.vue',
  '.svelte',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
] as const;

const BACKEND_EXTENSIONS = [
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.rb',
  '.php',
  '.cs',
  '.lua',
  '.sql',
  '.sh',
  '.bash',
  '.ps1',
] as const;

const C_FAMILY_EXTENSIONS = ['.c', '.h', '.cc', '.cpp', '.hpp'] as const;

const PATCH_EXTENSIONS = ['.diff', '.patch'] as const;

export const COMPOSER_FILE_ACCEPT = [
  ...MEDIA_TYPES,
  // 覆盖无扩展名或扩展名不固定的纯文本文件
  'text/*',
  ...TEXT_AND_CONFIG_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...FRONTEND_EXTENSIONS,
  ...BACKEND_EXTENSIONS,
  ...C_FAMILY_EXTENSIONS,
  ...PATCH_EXTENSIONS,
].join(',');
