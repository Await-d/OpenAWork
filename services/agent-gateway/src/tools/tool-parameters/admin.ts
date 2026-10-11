import type { ToolParameters } from './tool-parameter-schema.js';

export function buildAdminParameters(name: string): ToolParameters | undefined {
  switch (name) {
    case 'mcp_list_tools':
      return {
        type: 'object',
        properties: {
          serverId: {
            type: 'string',
            description: '可选的已配置 MCP 服务器 id。不传时列出所有启用的服务器。',
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'mcp_call':
      return {
        type: 'object',
        properties: {
          serverId: { type: 'string', description: '要调用的已配置 MCP 服务器 id' },
          toolName: {
            type: 'string',
            description: '由该 MCP 服务器暴露的工具名称',
          },
          arguments: {
            anyOf: [{ type: 'object' }, { type: 'string' }],
            description: '转发给 MCP 工具的参数。可以是 JSON 对象或以 JSON 编码的字符串。',
          },
        },
        required: ['serverId', 'toolName', 'arguments'],
        additionalProperties: false,
      };
    case 'mcp_manage_servers':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'update', 'remove', 'enable', 'disable'],
            description:
              '管理动作：list 列举；add/update 新增或覆盖；remove 移除；enable/disable 启停。',
          },
          server: {
            type: 'object',
            description:
              'add/update 时的服务器定义。内置 MCP（websearch / grep_app / codegraph / git_bash / lsp / omo）只接受 name 与 disabledTools。',
            properties: {
              id: {
                type: 'string',
                description: '服务器 id（小写字母 / 数字 / 短横线）；省略时由 name 生成。',
              },
              name: { type: 'string', description: '显示名称' },
              transport: { type: 'string', enum: ['sse', 'stdio'] },
              url: { type: 'string', description: 'sse 传输的完整 URL' },
              command: { type: 'string', description: 'stdio 传输的可执行命令' },
              args: { type: 'array', items: { type: 'string' } },
              cwd: { type: 'string', description: 'stdio 工作目录' },
              env: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'stdio 环境变量',
              },
              headers: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'sse 请求头（如 API Key）',
              },
              required: { type: 'boolean' },
              disabledTools: {
                type: 'array',
                items: { type: 'string' },
                description: '要禁用的工具名列表',
              },
              oauth: {
                description: 'OAuth 配置；false 表示显式关闭。省略时沿用原值。',
                oneOf: [
                  { type: 'boolean', enum: [false] },
                  {
                    type: 'object',
                    properties: {
                      clientId: { type: 'string' },
                      clientSecret: { type: 'string' },
                      scope: { type: 'string' },
                      redirectUri: { type: 'string' },
                    },
                    additionalProperties: false,
                  },
                ],
              },
            },
            required: ['name', 'transport'],
            additionalProperties: false,
          },
          serverId: {
            type: 'string',
            description: 'update/remove/enable/disable 的目标服务器 id。',
          },
          enabled: {
            type: 'boolean',
            description: 'add/update 时可显式指定启用状态；省略时保留原值（新增默认启用）。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'memory_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'update', 'delete'],
            description: '管理动作：list 检索/列举；add 新增；update 修改；delete 删除。',
          },
          memoryId: { type: 'string', description: 'update/delete 的目标记忆 id。' },
          memory: {
            type: 'object',
            description: '记忆内容。add 必须提供 type / key / value；update 可只传要修改的字段。',
            properties: {
              type: {
                type: 'string',
                enum: ['preference', 'fact', 'instruction', 'project_context', 'learned_pattern'],
              },
              key: { type: 'string', description: '记忆键（1–200 字符）。' },
              value: { type: 'string', description: '记忆内容（1–4000 字符）。' },
              priority: { type: 'integer', minimum: 0, maximum: 100 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              workspaceRoot: {
                type: ['string', 'null'],
                description: '限定到某个工作区路径（可选）。',
              },
              roleLayers: {
                type: ['array', 'null'],
                items: {
                  type: 'string',
                  enum: ['reception', 'pm1', 'pm2', 'executor', 'reviewer'],
                },
              },
              enabled: { type: 'boolean', description: 'update 时可启停该记忆。' },
            },
            additionalProperties: false,
          },
          search: { type: 'string', description: 'list 的 key/value 关键词过滤。' },
          type: {
            type: 'string',
            enum: ['preference', 'fact', 'instruction', 'project_context', 'learned_pattern'],
            description: 'list 的类型过滤。',
          },
          enabled: { type: 'boolean', description: 'list 的启用态过滤。' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'list 返回上限，默认 50。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'skill_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'install', 'uninstall', 'enable', 'disable'],
            description: '管理动作：list 列举；install 安装；uninstall 卸载；enable/disable 启停。',
          },
          skillId: {
            type: 'string',
            description:
              '目标技能 id（list 之外必填）。install 仅支持已配置注册源技能；github: / claude-marketplace: 前缀请在设置页安装。',
          },
          sourceId: {
            type: 'string',
            description: 'install 时可指定注册源 id；省略时由注册源解析。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'plugin_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'list',
              'search',
              'source_list',
              'install',
              'uninstall',
              'enable',
              'disable',
              'reload',
              'source_add',
              'source_remove',
            ],
            description:
              '管理动作：list 已安装插件；search 搜索市场；source_list/source_add/source_remove 市场来源；install 安装；uninstall 卸载；enable/disable 启停；reload 重载。',
          },
          query: { type: 'string', description: 'search 的关键字（可选）。' },
          sourceId: {
            type: 'string',
            description: '市场条目来源 id（owner/repo，install 与 source_remove 用）。',
          },
          name: { type: 'string', description: '市场条目插件名（install 与 sourceId 配套）。' },
          repo: {
            type: 'string',
            description:
              'GitHub 仓库（owner/repo 或 owner/repo@ref）；install 直装与 source_add 用。',
          },
          path: { type: 'string', description: '仓库内插件路径（install，可选）。' },
          ref: { type: 'string', description: '分支 / tag（install 与 source_add，可选）。' },
          installId: {
            type: 'string',
            description: '已安装插件目录名（uninstall / reload 必填）。',
          },
          pluginId: { type: 'string', description: '插件 id（enable / disable 必填）。' },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'schedule_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'update', 'remove', 'enable', 'disable', 'history'],
            description:
              '管理动作：list 列举；add 新建；update 修改；remove 删除；enable/disable 启停；history 执行历史。',
          },
          jobId: { type: 'string', description: 'list 之外的目标任务 id。' },
          job: {
            type: 'object',
            description: 'add 必须提供 name / schedule_kind / prompt；update 可只传要修改的字段。',
            properties: {
              name: { type: 'string' },
              schedule_kind: { type: 'string', enum: ['at', 'every', 'cron'] },
              schedule_at: {
                type: ['number', 'null'],
                description: 'at 调度的一次性触发时间（epoch 毫秒）。',
              },
              schedule_every: {
                type: ['number', 'null'],
                description: 'every 调度的间隔毫秒数。',
              },
              schedule_expr: {
                type: ['string', 'null'],
                description: 'cron 调度的 5 段表达式（分 时 日 月 周）。',
              },
              schedule_tz: { type: 'string', description: 'IANA 时区，默认 UTC。' },
              prompt: { type: 'string', description: '到点执行的任务提示词。' },
              agent_id: { type: ['string', 'null'] },
              model: { type: ['string', 'null'] },
              working_folder: { type: ['string', 'null'] },
              session_id: { type: ['string', 'null'] },
              delivery_mode: { type: 'string', enum: ['desktop', 'session', 'none'] },
              delivery_target: { type: ['string', 'null'] },
              plugin_id: { type: ['string', 'null'] },
              plugin_chat_id: { type: ['string', 'null'] },
              enabled: { type: 'boolean' },
              delete_after_run: { type: 'boolean', description: '一次性任务执行后自动删除。' },
              max_iterations: { type: 'integer', minimum: 1, maximum: 100 },
            },
            additionalProperties: false,
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'agent_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'update', 'delete', 'reset'],
            description:
              '管理动作：list 列举；create 新建；update 修改；delete 删除；reset 恢复默认。',
          },
          agentId: { type: 'string', description: 'update/delete/reset 的目标 Agent id。' },
          agent: {
            type: 'object',
            description:
              'create 需要 label 与 systemPrompt（可含 description / aliases / canonicalRole / model / variant / fallbackModels / note / enabled）；update 只需提供要改的字段。',
            additionalProperties: true,
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'team_workspace_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'update', 'delete'],
            description: '管理动作：list 列举；create 新建；update 修改；delete 删除。',
          },
          workspaceId: { type: 'string', description: 'update/delete 的目标工作区 id。' },
          workspace: {
            type: 'object',
            description:
              'create 需要 name；update 只需提供要改的字段。defaultTeamRoster 槽位需完整字段，能力绑定 skillIds/mcpServerIds 必须已安装/已配置。',
            properties: {
              name: { type: 'string' },
              description: { type: ['string', 'null'] },
              visibility: { type: 'string', enum: ['open', 'closed', 'private'] },
              defaultWorkingRoot: { type: ['string', 'null'] },
              defaultTeamRoster: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
                description:
                  '成员槽位数组；每项需 id / layer / specialty / displayName / personaKey / toolsets / required。',
              },
            },
            additionalProperties: false,
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'repo_clone':
      return {
        type: 'object',
        properties: {
          repository: {
            type: 'string',
            description: '要克隆的仓库：可传 git URL、host/path 引用、或 GitHub 的 owner/repo 简写',
          },
          branch: {
            type: 'string',
            description: '要克隆与查看的分支或 ref',
          },
          refresh: {
            type: 'boolean',
            description: 'true 时从远端拉取最新状态到受控缓存',
          },
        },
        required: ['repository'],
        additionalProperties: false,
      };
    case 'repo_overview':
      return {
        type: 'object',
        properties: {
          repository: {
            type: 'string',
            description:
              '要查看的缓存仓库：可传 git URL、host/path 引用、或 GitHub 的 owner/repo 简写',
          },
          path: {
            type: 'string',
            description:
              '要查看的目录绝对路径（代替缓存仓库）。除非 OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH=1，否则必须位于 repos 缓存根目录或已配置的 workspace root 内',
          },
          depth: {
            type: 'integer',
            minimum: 1,
            maximum: 6,
            description: '要包含的最大结构深度，默认 3。',
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'models':
      return {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '要在模型名称与 ID 中搜索的文本，按空白拆分为多个关键词。',
          },
          provider: {
            type: 'string',
            description: '按 Provider ID 或名称过滤；建议先试自身所在 Provider。',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: '返回的模型数量上限，默认 20。',
          },
          offset: {
            type: 'integer',
            minimum: 0,
            description: '分页偏移量，默认 0。',
          },
        },
        required: [],
        additionalProperties: false,
      };
    default:
      return undefined;
  }
}
