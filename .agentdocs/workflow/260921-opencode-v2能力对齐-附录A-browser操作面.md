# 附录 A：上游 `browser.*` 操作面完整清单（opencode v2.0.12）

- **关联主方案**：[260921-opencode-v2能力对齐.md](260921-opencode-v2能力对齐.md)
- **来源**：`@temp/opencode/packages/plugin-browser/src/rpc.ts:154-487`（`Operations`，共 **43** 个），注册见 `tools.ts:36-58`
- **通用约束**：`permission: "browser"`、`codemode: true`；每次调用必须带显式 `tabID`；页面内容/日志/请求体一律声明为**不可信数据**；跨机文件以**字节**传输，返回路径是**服务端本地路径**

## A.1 操作清单与在本仓的对应

| 上游操作 | 用途（摘要） | 本仓 `desktop_automation` 对应 |
|---|---|---|
| `tabs.list` | 列出会话标签页与聚焦页 | ❌ 无多标签管理 |
| `tabs.open` | 新开标签页并在 Review 面板显示 | ⚠️ `start`（近似） |
| `tabs.focus` | 聚焦某标签页 | ❌ |
| `tabs.close` | 关闭标签页并释放资源 | ❌ |
| `preview` | 在 Review 面板预览文件（图/音/视频/PDF/HTML/MD/CSV…） | ❌ 无对应工具 |
| `navigate` | 导航到 HTTP(S)/about:blank 并等待加载 | ✅ `goto` |
| `back` / `forward` | 前进后退并等待加载 | ✅ `back` / `forward` |
| `reload` | 重载（性能录制前用） | ✅ `reload` |
| `stop` | 停止加载（不停 trace/CPU） | ❌ |
| `frames` | 列出含跨域在内的 frame | ❌ |
| `snapshot` | 可访问性快照 + 元素 ref | ✅ `snapshot` |
| `find` | 快照内字面量文本查找（刷新 ref） | ❌ |
| `evaluate` | 在页面/ frame 内执行 JS（仅 JSON 可序列化返回） | ❌ 底层已有（未暴露） |
| `click` | 按 ref 点击（双击/右键/中键/修饰键） | ⚠️ `click`（无 ref/修饰键） |
| `hover` | 悬停 | ❌ |
| `drag` | ref→ref 拖拽 | ❌ |
| `fill` | 替换可编辑元素文本 | ⚠️ `type`（近似） |
| `fill_form` | 批量按序填表（text/select/check） | ❌ |
| `select` | 按 value 选择下拉项（支持多选） | ❌ |
| `check` | 显式设置勾选态（非盲切） | ❌ |
| `press` | 按键/组合键（Enter、Control+A…） | ✅ `press` |
| `scroll` | CSS 像素滚动 | ✅ `scroll` |
| `wait` | 等加载或文本出现/消失（禁固定 sleep） | ✅ `wait` |
| `screenshot` | 视口/整页/元素截图（返回附件 + 服务端路径） | ✅ `screenshot` |
| `dialog` | 检查/接受/关闭 alert/confirm/prompt | ❌ |
| `files.upload` | 上传服务端本地文件到 file input（≤5 MiB） | ❌ |
| `files.drop` | 拖放服务端本地文件到元素（≤5 MiB） | ❌ |
| `files.list` | 列出该标签页的下载/采集文件 | ❌ |
| `files.get` | 把某下载/采集拷回服务端（≤5 MiB） | ❌ |
| `console` | 有界读取控制台消息与未捕获错误 | ❌ 底层已有（未暴露） |
| `network.list` | 列出已捕获请求（`urlContains` 字面量） | ❌ |
| `network.get` | 检查单个请求（body 默认省略、按需有界） | ❌ |
| `trace.start` | 启动 Chromium 性能 trace（仅一个录制） | ❌ |
| `trace.stop` | 结束 trace 并压缩文件拷回服务端 | ❌ |
| `trace.analyze` | 分析保留的 trace（长任务/脚本/渲染/绘制） | ❌ |
| `cpu.start` | 启动 JS CPU 采样（自动 30s 上限） | ❌ |
| `cpu.stop` | 结束采样并拷回 `.cpuprofile` | ❌ |
| `cpu.analyze` | 读 profile 并列出热点函数（自采样） | ❌ |
| `heap.snapshot` | 抓取 JS 堆并压缩拷回（≤5 MiB，短暂暂停页面） | ❌ |
| `heap.summary` | 按类/浅字节汇总堆快照 | ❌ |
| `heap.query` | 按名子串查堆对象（有界、按浅大小排序） | ❌ |
| `heap.object` | 查看单个对象 ID（有界出边与 retainers） | ❌ |
| `heap.compare` | 对比两份快照（类计数/浅字节，非泄漏证明） | ❌ |
| `lighthouse` | 可访问性/SEO/最佳实践审计（不做设备模拟/性能基准） | ❌ |

## A.2 差距小结

- **齐平/近似（8）**：`navigate`/`back`/`forward`/`reload`/`snapshot`/`press`/`scroll`/`wait`/`screenshot` 已具备；`tabs.open`/`click`/`fill` 为近似（缺 ref、修饰键、批量）。
- **完全缺失（30+）**，可归为四类：
  1. **交互完备性**：`find`/`hover`/`drag`/`fill_form`/`select`/`check`/`dialog`/`frames`/`stop`。
  2. **可观测性**：`console`/`network.list`/`network.get`（本仓底层已有 console 事件与 CDP，**主要是未暴露**）。
  3. **性能与内存剖析**：`trace.*`/`cpu.*`/`heap.*`（本仓完全无，属新增能力）。
  4. **文件双向**：`files.upload`/`files.drop`/`files.list`/`files.get`/`preview`（跨机字节传输 + Review 面板预览）。
- **D-2 落地建议（已决策：扩展现有 `desktop_automation`）**：按「先暴露底层已有能力，再补新能力」分两批——
  - **第一批（低成本，底层已具备）**：`evaluate`、`console`、`network.list`/`network.get`、`find`、`frames`、`hover`、`select`、`check`。
  - **第二批（需新增实现）**：`trace.*`、`cpu.*`、`heap.*`、`lighthouse`、`files.*`、`preview`、`dialog`、`drag`、`fill_form`。
- **注意**：本仓当前无多标签页模型，`tabs.*` 需先决定是否引入「会话级标签页」概念；否则该组应显式标为不支持，避免工具描述与实现不符。
