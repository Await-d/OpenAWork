# 故障排查指南

本目录包含 OpenAWork 项目常见问题的诊断和解决方案。

## 快速诊断

### MCP 工具不可用错误

**错误信息**：`AI_NoSuchToolError: Model tried to call unavailable tool 'mcp_list_tools'`

**快速诊断**：

```bash
pnpm exec tsx scripts/diagnose-mcp-tools.ts
```

**详细文档**：[mcp-tools-error.md](./mcp-tools-error.md)

**快速修复**（禁用 Flat MCP 模式）：

1. 在 `.env` 中添加：`OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1`
2. 重启 Gateway：`pnpm --filter @openAwork/agent-gateway dev`

---

## 常见问题分类

### 工具相关

- [MCP 工具不可用错误](./mcp-tools-error.md) - `AI_NoSuchToolError: mcp_list_tools`

### 环境配置

- 待补充

### 数据库

- 待补充

### 网络连接

- 待补充

---

## 通用诊断步骤

### 1. 检查环境变量

确认所有必需的环境变量已设置：

```bash
# 检查 .env 文件
cat .env

# 或查看环境变量示例
cat .env.example
```

必需变量：

- `JWT_SECRET` - JWT 签名密钥（至少 32 字符）
- `OPENAWORK_DATA_DIR` - 数据目录
- `REDIS_URL` - Redis 连接字符串
- `AI_API_KEY` - AI 模型 API 密钥
- `AI_API_BASE_URL` - AI 模型 API 地址
- `AI_DEFAULT_MODEL` - 默认 AI 模型

### 2. 检查服务状态

```bash
# 检查 Gateway 是否运行
pnpm --filter @openAwork/agent-gateway dev

# 检查 Redis 是否运行
redis-cli ping

# 检查数据库连接
ls -la ~/.local/share/OpenAWork/agent-gateway/
```

### 3. 查看日志

Gateway 日志通常包含有用的错误信息：

```bash
# 查看 Gateway 启动日志
pnpm --filter @openAwork/agent-gateway dev 2>&1 | tee gateway.log

# 过滤错误信息
grep -i "error\|warn\|fail" gateway.log
```

### 4. 清除缓存

有时清除缓存可以解决问题：

```bash
# 清除 pnpm 缓存
pnpm store prune

# 重新安装依赖
pnpm install

# 重新构建
pnpm build
```

---

## 报告问题

如果问题仍未解决，请在 GitHub Issues 中报告，并提供：

1. **错误信息**：完整的错误堆栈
2. **环境信息**：
   - Node.js 版本：`node --version`
   - pnpm 版本：`pnpm --version`
   - 操作系统：`uname -a`
3. **重现步骤**：详细的操作步骤
4. **诊断信息**：相关诊断脚本的输出
5. **日志文件**：相关的日志片段

---

## 贡献

欢迎贡献新的故障排查文档！请遵循以下格式：

1. 创建 `docs/troubleshooting/<问题名称>.md`
2. 包含以下章节：
   - 错误信息
   - 问题原因
   - 解决方案（多个方案按推荐程度排序）
   - 验证修复
   - 技术细节（可选）
   - 相关文件
3. 在本 README 中添加链接
