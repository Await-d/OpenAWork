/**
 * 失败卡验收用的四类真实样本（逐字取自 `audit_logs`，与
 * `shared/tool-failure-view.test.ts` 保持一致）。
 *
 * 不要「顺手美化」这些字符串：正则只对线上原样文本成立。
 */

export interface ToolFailureFixture {
  id: string;
  /** 卡片标题行应出现的分类标签。 */
  expectedLabel: string;
  /** 卡片标题行应出现的一句话结论。 */
  expectedHeadline: string;
  /** 展开后应出现的字段标签（顺序无关）。 */
  expectedFields: string[];
  toolName: string;
  input: Record<string, unknown>;
  output: string;
}

export const AGENTIGNORE_DENIAL =
  'Access denied: file "/home/await/project/OpenAWork/.omo/ime-guard-apply.ts" is protected by agentignore rules. 该类路径受 agentignore 保护(常见受保护模式:`.env` / `.env.*`、`*.pem` / `*.key` / `id_rsa*`、`.aws/credentials`、`*.sqlite` / `*.db`、`node_modules/**`、`.git/**` 等)。请勿重复尝试读取或写入;如需其中的值,请让用户显式提供,或改读不含敏感值的等价文件(如 `.env.example`)。';

export const READ_BEFORE_EDIT =
  'You must read file "/home/await/project/OpenAWork/apps/web/src/pages/chat-page/panels/sub-session-detail-panel.tsx" before editing it';

export const WORKSPACE_ESCAPE =
  '目标路径超出当前工作区范围：/tmp/mwg-guide-1005252-1794926975048.md（当前工作区：/home/await/project/OpenAWork）';

export const ENOENT =
  "ENOENT: no such file or directory, stat '/home/await/project/OpenAWork/apps/web/src/components/permissions/PermissionPrompt.tsx'";

export const TOOL_FAILURE_FIXTURES: readonly ToolFailureFixture[] = [
  {
    id: 'agentignore',
    expectedLabel: '写入被拒绝',
    expectedHeadline: 'agentignore 保护路径',
    expectedFields: ['路径', '原因', '建议'],
    toolName: 'write',
    input: { filePath: '/home/await/project/OpenAWork/.omo/ime-guard-apply.ts', content: 'x' },
    output: AGENTIGNORE_DENIAL,
  },
  {
    id: 'read-before-edit',
    expectedLabel: '需要先读取文件',
    expectedHeadline: '编辑前需先读取文件',
    expectedFields: ['路径', '建议'],
    toolName: 'write',
    input: {
      filePath:
        '/home/await/project/OpenAWork/apps/web/src/pages/chat-page/panels/sub-session-detail-panel.tsx',
      content: 'x',
    },
    output: READ_BEFORE_EDIT,
  },
  {
    id: 'workspace-escape',
    expectedLabel: '超出工作区范围',
    expectedHeadline: '目标路径超出工作区范围',
    expectedFields: ['路径', '工作区', '建议'],
    toolName: 'write',
    input: { filePath: '/tmp/mwg-guide-1005252-1794926975048.md', content: 'x' },
    output: WORKSPACE_ESCAPE,
  },
  {
    id: 'enoent',
    expectedLabel: '系统错误',
    expectedHeadline: '文件或目录不存在',
    expectedFields: ['错误码', '详情', '操作', '路径'],
    toolName: 'write',
    input: {
      filePath:
        '/home/await/project/OpenAWork/apps/web/src/components/permissions/PermissionPrompt.tsx',
      content: 'x',
    },
    output: ENOENT,
  },
  {
    // inline 通道（`read`）走 InlineToolCall，必须和 block 通道表现一致。
    id: 'inline-read',
    expectedLabel: '需要先读取文件',
    expectedHeadline: '编辑前需先读取文件',
    expectedFields: ['路径', '建议'],
    toolName: 'read',
    input: {
      path: '/home/await/project/OpenAWork/apps/web/src/pages/chat-page/panels/sub-session-detail-panel.tsx',
    },
    output: READ_BEFORE_EDIT,
  },
  {
    // 认不出形态：只给标题行 + 原始输出，不硬凑字段。
    id: 'plain-fallback',
    expectedLabel: '',
    expectedHeadline: '写文件时发生了未知问题',
    expectedFields: [],
    toolName: 'write',
    input: { filePath: '/tmp/unknown.ts', content: 'x' },
    output:
      '写文件时发生了未知问题\n    at writeFile (fs.ts:1:1)\n    at process (node:internal:1)',
  },
];
