# MCP 工具不可用错误排查

## 错误信息

```
AI_NoSuchToolError: Model tried to call unavailable tool 'mcp_list_tools'
```

## 问题原因

OpenAWork 系统默认启用了 **Flat MCP 模式**，该模式会：

1. 将所有 MCP 工具扁平化为 `mcp__<serverId>__<toolName>` 格式
2. 隐藏传统的 `mcp_list_tools` 和 `mcp_call` 包装工具
3. 为模型提供更直接、更高效的 MCP 工具调用方式

但在以下情况下，可能会出现工具不可用的错误：

- 模型使用了缓存的旧 prompt，其中引用了 `mcp_list_tools`
- 系统提示词中仍然包含对这些工具的引用
- 用户的 MCP 服务器配置不正确或未启动

## 解决方案

### 方案 1：禁用 Flat MCP 模式（推荐用于调试）

如果你需要使用传统的 `mcp_list_tools` 和 `mcp_call` 工具，可以禁用 Flat MCP 模式：

1. 在 `.env` 文件中添加或修改：

```bash
OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1
```

2. 重启 Agent Gateway：

```bash
pnpm --filter @openAwork/agent-gateway dev
```

### 方案 2：检查 MCP 服务器配置

确保你的 MCP 服务器已正确配置并启动：

1. 检查用户设置中的 MCP 服务器配置
2. 确认服务器状态为 "connected"
3. 检查服务器日志是否有错误信息

### 方案 3：清除模型缓存

如果问题是由于缓存的 prompt 导致的：

1. 创建新的会话
2. 确保系统提示词中没有引用 `mcp_list_tools`
3. 让模型使用扁平化的 MCP 工具名称

## 验证修复

### 检查 Flat MCP 模式状态

运行诊断脚本：

```bash
pnpm exec tsx scripts/diagnose-mcp-tools.ts
```

输出示例：

```
=== MCP 工具诊断 ===

1. 工具定义检查:
   mcp_list_tools: ✓ 已定义
   mcp_call: ✓ 已定义
   描述: 列出当前用户启用的 MCP 服务器以及每个服务器上可用的工具。

2. Flat MCP 模式:
   已禁用: 否
   说明: mcp_list_tools/mcp_call 会被隐藏

3. 环境变量检查:
   OPENAWORK_DISABLE_MCP_FLAT_TOOLS: (未设置)

=== 诊断完成 ===

建议：
- Flat MCP 模式已启用，mcp_list_tools 和 mcp_call 会被隐藏
- 这是正常行为，应该使用扁平化的 mcp__<serverId>__<toolName> 工具
```

### 测试 MCP 工具调用

1. **Flat 模式启用时**（默认）：
   - 模型应该能看到形如 `mcp__github__list_repos` 的工具
   - 不应该看到 `mcp_list_tools` 和 `mcp_call`

2. **Flat 模式禁用时**（`OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1`）：
   - 模型应该能看到 `mcp_list_tools` 和 `mcp_call`
   - 不应该看到扁平化的工具名称

## 技术细节

### Flat MCP 模式

**代码位置**：`services/agent-gateway/src/routes/stream.ts:2448-2502`

**工作原理**：

```typescript
const flatMcpToolDefinitionsEnabled = !isFlatMcpToolsDisabled();

if (flatMcpToolDefinitionsEnabled) {
  // 隐藏传统工具
  baseToolsForTurn = baseTools.filter(
    (tool) => tool.function.name !== 'mcp_list_tools' && tool.function.name !== 'mcp_call',
  );

  // 添加扁平化工具
  flatMcpDefs = buildFlatMcpToolDefinitions(catalogs);
}
```

### 工具执行处理器

**代码位置**：`services/agent-gateway/src/tools/tool-sandbox.ts:2270-2284`

即使 Flat 模式启用，执行处理器仍然保留，以支持：

- 历史会话回放（旧会话可能包含 `mcp_call` 调用）
- 手动禁用 Flat 模式的场景

## 相关文件

- `services/agent-gateway/src/mcp/mcp-tool-naming.ts` - Flat MCP 模式判断
- `services/agent-gateway/src/routes/stream.ts` - 工具列表过滤
- `services/agent-gateway/src/tools/tool-sandbox.ts` - 工具执行
- `services/agent-gateway/src/tools/tool-definitions.ts` - 工具定义

## 常见问题

### Q: 为什么要有 Flat MCP 模式？

A: Flat MCP 模式的优势：

- 减少模型需要调用的步骤（无需先 `mcp_list_tools` 再 `mcp_call`）
- 更小的 prompt 体积
- 更稳定的缓存前缀
- 更直观的工具命名

### Q: 什么时候应该禁用 Flat MCP 模式？

A: 以下情况可能需要禁用：

- 调试 MCP 工具调用问题
- 模型微调依赖于特定的工具名称
- 需要与旧版本行为保持一致

### Q: 禁用 Flat MCP 模式有什么影响？

A: 禁用后：

- 模型需要先调用 `mcp_list_tools` 查看可用工具
- 然后通过 `mcp_call` 调用具体工具
- Prompt 体积会稍大
- 但功能完全相同

## 联系支持

如果问题仍未解决，请：

1. 收集诊断信息：运行 `pnpm exec tsx scripts/diagnose-mcp-tools.ts`
2. 检查 Gateway 日志中的错误信息
3. 在 GitHub Issues 中报告问题，附上诊断信息
