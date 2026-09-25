# 从 V1 迁移插件到 V2

OpenAWork 的插件平台对齐 opencode v2。V1 插件（PR-D-Plugin 时代）仍然兼容（自动 shim），但新代码应使用 v2 形态。本文档给出逐项映射。

## 1. 入口形态

```js
// V1 —— factory 返回 hook map
export default async function () {
  return {
    'tool.execute.before': async (input, output) => {
      if (input.tool === 'bash') output.args = redact(output.args);
    },
  };
}
```

```js
// V2 —— define({ id, setup })；hook 在 setup 内注册到域上
export default {
  id: 'my-plugin', // 稳定 id：注册表标识 + 存储命名空间
  setup(ctx) {
    ctx.tool.hook('execute.before', (event) => {
      if (event.tool === 'bash') event.args = redact(event.args);
    });
    // 可选 cleanup（定时器 / 套接字 / 子进程）
    return () => {};
  },
};
```

- **id 是新增要求**：V1 用 source 路径作标识；V2 需要稳定 `id`（存储、状态、列表都按它）。
- V2 是**单事件可变对象**（不再分 `input` / `output` 两个参数）；可变字段直接写在事件上。
- `define` 是可选的类型糖（identity 函数）；运行时只要求形状 `{ id, setup }` 或 `{ id, effect }`。

## 2. Hook 映射

| V1 hook               | V2 注册                               | 说明                                                                |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `tool.execute.before` | `ctx.tool.hook('execute.before', cb)` | `output.args` → `event.args`                                        |
| `tool.execute.after`  | `ctx.tool.hook('execute.after', cb)`  | `output.output` / `output.title` / `output.metadata` → 事件同名字段 |
| `chat.message`        | `ctx.session.hook('prompt', cb)`      | `output.message` / `output.parts` → 事件同名字段（advisory）        |
| `chat.params`         | `ctx.session.hook('context', cb)`     | `output.temperature` 等 → 事件同名字段                              |
| `permission.evaluate` | `ctx.permission.hook('evaluate', cb)` | 语义不变（deny-only）                                               |

旧 hook 名（`chat.message` / `chat.params`）在 shim 中仍被接受；v2 代码请用域 API。

## 3. V2 新增能力

V1 只有 5 个 hook。V2 额外提供：

- `ctx.tool.transform(editor)` —— 注册 / 移除工具（见 `README.md` 的工具注册节）
- `ctx.event.subscribe({ types })` —— 订阅网关事件（优雅退订随插件卸载）
- `ctx.storage.get/set/remove/scan` —— 插件级持久化 JSON 存储
- `ctx.plugin.list()` —— 查询当前已加载插件

## 4. 生命周期差异

| V1                           | V2                                                                       |
| ---------------------------- | ------------------------------------------------------------------------ |
| 加载后永久存在（无卸载概念） | `setup` 返回 cleanup；Effect 插件用 `Scope`（`acquireRelease` 自动释放） |
| 环境变量一次性加载，无热重载 | 本地文件热重载（digest 去重）；加载失败可修复后自动重试                  |
| 无 id、无状态                | `id` + `failed`/`active` 状态（`GET /plugins`）                          |
| 错误全部吞掉（warn）         | 语义不变：hook 抛错只 warn；工具执行失败返回 `isError` 结果              |

## 5. 配置迁移

```jsonc
// V1 —— 仅环境变量
// OPENAWORK_PLUGINS=/path/a.js,/path/b.js

// V2 —— <dataDir>/openawork.json（env 仍然可用）
{
  "plugins": [
    "some-package",
    { "package": "./local/plugin", "options": { "strict": true } },
    "-legacy-plugin",
  ],
}
```

目录发现：把插件放到 `<dataDir>/plugins/<name>/index.mjs` 即被自动加载。

## 6. 校验清单

1. `GET /plugins` 中能看到新插件（`state.status === 'active'`）。
2. 逐个 hook 行为与迁移前一致（`tool.execute.*` 的 args/output 往返）。
3. 插件工具（如有）在下一回合出现在模型工具面，且调用时需要审批。
4. 卸载（`DELETE /plugins/:installId` 或删除目录）后 hook / 工具 / 订阅全部停止。
5. 热重载：编辑 entrypoint 文件后行为切换，无需重启网关。
