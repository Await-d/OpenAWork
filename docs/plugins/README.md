# 插件开发指南（Plugin SDK v2）

OpenAWork 的插件平台对齐 opencode v2：插件是**网关级的运行时扩展**，可注册 hook、贡献工具、订阅事件、持久化状态。插件运行在网关进程内，与网关共享同一信任边界（**没有沙箱**）——只加载你掌控或审计过的代码。

## 快速开始

```
<dataDir>/plugins/my-plugin/index.mjs
```

```js
// index.mjs —— Promise 形态（包主入口）
import { define } from '@openAwork/plugin-sdk';

export default define({
  id: 'my-plugin',
  setup(ctx) {
    ctx.tool.hook('execute.before', (event) => {
      if (event.tool === 'bash') {
        event.args = redact(event.args); // 改写 args，下游执行看到改写后的值
      }
    });
    return () => {
      /* 可选 cleanup：定时器 / 套接字等 */
    };
  },
});
```

Effect 形态（`@openAwork/plugin-sdk/effect`）：

```js
import { define } from '@openAwork/plugin-sdk/effect';
import { Effect } from 'effect';

export default define({
  id: 'my-effect-plugin',
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => openResource()),
        () => Effect.sync(() => closeResource()),
      );
      ctx.tool.hook('execute.before', (event) => {
        /* ... */
      });
    }),
});
```

Effect 插件的 `effect` 运行在**长生命周期 Scope** 中：卸载插件时 scope 关闭，`acquireRelease` 资源自动释放。

## 插件从哪来

按优先级合并（同名以先加载者为准，逐源去重）：

1. **声明式配置** `<dataDir>/openawork.json` 的 `plugins` 数组（推荐）
2. **目录发现** `<dataDir>/plugins/*/`（entrypoint 候选：`index.js` / `index.mjs` / `index.cjs` / `server.js` / `server.mjs` / `main.js`）
3. **环境变量** `OPENAWORK_PLUGINS=path1,/abs/path2,@scope/pkg`（兼容旧用法）

配置文件语法（对齐 opencode v2）：

```json
{
  "plugins": [
    "some-package",
    { "package": "./local/plugin", "options": { "strict": true } },
    "-disabled-plugin",
    "-*",
    "keep-me"
  ]
}
```

- `-target`：移除匹配的来源（按 spec 或目录名匹配）
- `-*`：移除全部
- `*` / `prefix.*` / 精确名：把被移除的目标重新启用（`["-*", "keep-me"]` = 只保留 `keep-me`）

只有 `add` 形式支持 `options`；env 与目录发现不支持 options。

## 热重载

本地插件的 entrypoint 文件被监听（`fs.watch` + SHA-256 digest 去重）：编辑保存后自动重载，无需重启网关。**依赖文件**（插件 import 的其他文件）目前不触发重载。加载失败的来源保留追踪，修复文件后自动重试。

## 生命周期与错误隔离

- 插件的 hook / 工具 / 事件订阅在**卸载时自动清理**（注册随插件作用域）。
- 任何 hook 抛错只记录警告，**不会中断对话回合或工具执行**。
- 激活失败会记录为 `failed` 状态（`GET /plugins` 可见），不影响其他插件与网关启动。

## 能力域

### hook

| hook                                  | 时机           | 可变字段                                                   |
| ------------------------------------- | -------------- | ---------------------------------------------------------- |
| `ctx.tool.hook('execute.before', cb)` | 工具执行前     | `event.args`                                               |
| `ctx.tool.hook('execute.after', cb)`  | 工具返回后     | `event.output` / `event.title` / `event.metadata`          |
| `ctx.session.hook('prompt', cb)`      | 处理用户消息时 | `event.message` / `event.parts`（advisory）                |
| `ctx.session.hook('context', cb)`     | 模型请求派发前 | `event.temperature` 等采样参数 / `event.options`           |
| `ctx.permission.hook('evaluate', cb)` | 权限裁决后     | **仅可降级**：`event.effect = 'deny'`（+ `event.message`） |

权限 hook 是 **deny-only 后置裁决**：插件只能把放行/待审批降级为拒绝，永远无法授权——沙箱的 deny-first 不变量不变。

### 工具注册（`ctx.tool.transform`）

```js
ctx.tool.transform((editor) => {
  editor.add({
    name: 'plugin_hello', // [a-zA-Z][a-zA-Z0-9_-]{0,63}，不得与内置工具重名
    description: 'Greet the caller.',
    input: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    execute(input, execution) {
      return { output: `hello, ${input.name}` }; // { output, isError? }
    },
  });
});
```

- 工具名不得与**内置工具**冲突（注册时拒绝），不得与其他插件的工具重名。
- 插件工具**不会**映射到内置权限类别 → 权限阶梯解析为 `custom`（默认 `ask`），**永远无法免审批**。
- 定义与沙箱**每回合构建**：注册/移除在下一回合生效，无需缓存失效。
- 执行失败（含抛错）返回 `isError` 结果，不破坏回合。

### 事件订阅（`ctx.event.subscribe`）

```js
for await (const event of ctx.event.subscribe({ types: ['session.', 'todo.'] })) {
  if (event.type === 'session.idle') {
    /* ... */
  }
}
```

- **eager 订阅**：`subscribe()` 立即开始接收，迭代前发布的事件不丢。
- `types` 前缀过滤；队列有界（1000，超限丢最旧 + 一次 warn）。
- 插件卸载时订阅自动停止（`signal` 组合）。

### 存储（`ctx.storage`）

```js
await ctx.storage.set('settings', { strict: true });
const settings = await ctx.storage.get('settings');
const { entries } = await ctx.storage.scan({ prefix: 'cache:' });
await ctx.storage.remove('settings');
```

- 按插件 id 隔离，重启不丢（`plugin_storage` 表）。
- JSON 值；单值上限 256 KiB；卸载插件时清理该插件全部数据。

## 安装与管理

```bash
# 从本机路径安装（目录或单文件）
curl -X POST $GATEWAY/plugins/install \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"path": "/path/to/my-plugin"}'

# 列表（含 active/failed 状态与 guarded 标记）
curl $GATEWAY/plugins -H "Authorization: Bearer $TOKEN"

# 手动重载 / 卸载
curl -X POST $GATEWAY/plugins/my-plugin/reload -H "Authorization: Bearer $TOKEN"
curl -X DELETE $GATEWAY/plugins/my-plugin -H "Authorization: Bearer $TOKEN"
```

安装来源限于**网关所在机器的本地路径**（npm / zip 安装尚未支持）。安装后会立即激活；卸载会同时移除插件目录与该插件的存储数据。

浏览器端通过 `@openAwork/web-client` 的 `createPluginsClient(baseUrl)` 调用以上端点。

## 内置插件组（internal）

平台自带 3 个 **guarded 内部插件**（`GET /plugins` 中 `source: 'internal'`、`guarded: true`，配置无法移除）：

| 插件 id                      | 控制的工具                         | 开关位置                   |
| ---------------------------- | ---------------------------------- | -------------------------- |
| `builtin.image-generation`   | `generate_image`                   | 设置 → 插件 → 图像生成     |
| `builtin.desktop-control`    | `desktop_control` / `computer_use` | 设置 → 插件 → 桌面控制     |
| `builtin.desktop-automation` | `desktop_automation`               | 设置 → 插件 → 浏览器自动化 |

开关存储在 `user_settings.plugin_settings`（读写走 `/settings/plugins`）；门控按请求求值——在设置页切换后**下一回合**即生效，无需重启。

## 在线市场与一键安装

插件市场聚合**已配置的 GitHub 源**，支持浏览、搜索、预览（README）与一键安装。

### 添加来源

```
GET    /plugins/market/sources                 # 源列表
POST   /plugins/market/sources                 # { repo: "owner/repo" 或 "owner/repo@ref", ref?, name? }
DELETE /plugins/market/sources/:sourceId       # sourceId = owner/repo（URL 编码）
```

仓库根可放清单 `openawork-plugins.json`：

```json
{
  "name": "示例插件集",
  "plugins": [
    {
      "name": "echo",
      "path": "plugins/echo",
      "description": "回声插件",
      "version": "1.0.0",
      "author": "Acme"
    }
  ]
}
```

没有清单时，整个仓库按**单个根目录插件**处理（根目录需有 entrypoint）。

### 浏览与安装

```
GET  /plugins/market?query=...                 # 聚合清单（名称/描述/仓库/作者子串过滤）
GET  /plugins/market/entry?sourceId=...&name=...  # 条目详情（含 README 截断）
POST /plugins/install/github                   # { repo, path?, ref?, name?, force? }
```

安装流程：GitHub zipball → 解压（**解压前按原始大小拒绝 zip 炸弹**，zip-slip 防护）→ 暂存到 `<dataDir>/plugin-downloads/` → 复用本地安装器的原子落位（staging + rename + entrypoint 校验）→ 热重载激活。安装成功后可预测地在「已安装插件」面板中管理。

Web 端：设置 → 插件 → **插件市场**（`?plugin=market`）。安装按钮需要**二次确认**——确认文案展示来源仓库、ref 与路径，并明示「插件将以网关权限执行任意代码（无沙箱）」。

### 安全边界

- 仅支持 **GitHub 仓库**（HTTPS）；npm / zip 直传不在范围内。
- 下载有大小上限（归档 50MB / 解压展开 200MB）、超时（20s）、流式 bounded 读。
- 安装需要认证；来源可随时移除（不影响已安装插件）。
- 私有仓库暂不支持（清单与 README 走 `raw.githubusercontent.com`）。

## AI 自助管理（`plugin_manage`）

产品内 Agent 可在**用户审批**下管理插件与市场（对齐 `mcp_manage_servers` 的方式）：

| action                         | 说明                                                                      | 审批                              |
| ------------------------------ | ------------------------------------------------------------------------- | --------------------------------- |
| `list`                         | 已安装插件（状态 / 来源 / installId / guarded）                           | 只读免审批                        |
| `search`                       | 搜索市场（可选 `query`）                                                  | 只读免审批                        |
| `source_list`                  | 市场来源列表                                                              | 只读免审批                        |
| `install`                      | 从市场条目（`sourceId`+`name`）或 GitHub（`repo`，可带 `path`/`ref`）安装 | ask（预览含来源与「无沙箱」提示） |
| `uninstall`                    | 卸载（`installId`）                                                       | ask（预览：目录与存储数据将删除） |
| `enable` / `disable`           | 启停（`pluginId`）                                                        | ask；guarded 内置插件不可停用     |
| `reload`                       | 重载（`installId`）                                                       | ask                               |
| `source_add` / `source_remove` | 市场来源增删（`repo` / `sourceId`）                                       | ask                               |

- **权限类别** `plugin_manage`（默认 ask）；「永久允许」按动作隔离（`action:*`）——一次允许不会放开全部动作。
- **会话可见性**：team / cron / channel / clarify 会话不可见（插件是网关全局代码执行面），执行入口同样有会话守卫（双保险）。
- **安装路径**：仅市场来源（GitHub zipball）；不接受模型直传服务器本地路径。
- 安装成功返回 JSON（含 `installId`、来源、激活状态与信任 `notice`），模型应据此向用户交代来源与风险。

## 安全模型（务必阅读）

- 插件与网关**同进程、同权限**（文件系统 / 网络 / 环境变量 / 数据库）。平台**不提供沙箱**。
- `OPENAWORK_PLUGINS` / 配置文件 / 安装 API 只应指向你掌控或已审计的代码；安装是**持久化代码执行能力**。
- 插件工具无法进入免审批名单；权限 hook 只能收紧不能放宽。
- `guarded` 内部插件不可被配置移除（`GET /plugins` 的 `guarded` 字段）。

## 示例

见 `docs/plugins/examples/`：

- `guard-plugin.mjs` —— 拦截敏感文件读取（`tool.execute.before`）
- `tool-plugin.mjs` —— 注册工具 + 存储使用
- `notify-plugin.mjs` —— 事件订阅 + 日志

## 迁移

旧 V1 插件（`export default async function () { return { 'tool.execute.before': ... } }`）仍然兼容（shim 自动适配），但新代码请使用 v2 形态。迁移指引见 `docs/plugins/migrate-v1.md`。
