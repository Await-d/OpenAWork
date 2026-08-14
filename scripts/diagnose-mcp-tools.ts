#!/usr/bin/env node
/**
 * 诊断 MCP 工具可用性问题
 *
 * 检查项：
 * 1. mcp_list_tools 和 mcp_call 是否在工具定义中
 * 2. Flat MCP 模式是否启用
 * 3. 环境变量配置
 * 4. 提供修复建议
 *
 * 使用方法：
 *   pnpm exec tsx scripts/diagnose-mcp-tools.ts
 */

import { buildGatewayToolDefinitions } from '../services/agent-gateway/src/tools/tool-definitions.js';
import { isFlatMcpToolsDisabled } from '../services/agent-gateway/src/mcp/mcp-tool-naming.js';

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║            MCP 工具可用性诊断                                  ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// 1. 检查工具定义
console.log('📋 1. 工具定义检查');
console.log('─────────────────────────────────────────────────────────────');

try {
  const allTools = buildGatewayToolDefinitions();
  const mcpListTools = allTools.find((t) => t.function.name === 'mcp_list_tools');
  const mcpCall = allTools.find((t) => t.function.name === 'mcp_call');

  console.log(`   mcp_list_tools: ${mcpListTools ? '✅ 已定义' : '❌ 未定义'}`);
  console.log(`   mcp_call:       ${mcpCall ? '✅ 已定义' : '❌ 未定义'}`);

  if (mcpListTools) {
    console.log(`   描述: ${mcpListTools.function.description.slice(0, 50)}...`);
  }

  console.log(`   总工具数: ${allTools.length}`);
} catch (error) {
  console.log(`   ❌ 错误: ${error instanceof Error ? error.message : String(error)}`);
}

// 2. 检查 Flat MCP 模式
console.log('\n🔧 2. Flat MCP 模式状态');
console.log('─────────────────────────────────────────────────────────────');

const flatModeDisabled = isFlatMcpToolsDisabled();
const flatModeEnabled = !flatModeDisabled;

console.log(`   状态: ${flatModeEnabled ? '✅ 已启用 (默认)' : '⚠️  已禁用'}`);
console.log(`   工具可见性:`);

if (flatModeEnabled) {
  console.log(`     • mcp_list_tools: ❌ 被隐藏 (模型看不到)`);
  console.log(`     • mcp_call:       ❌ 被隐藏 (模型看不到)`);
  console.log(`     • mcp__*__*:      ✅ 可见 (扁平化工具)`);
} else {
  console.log(`     • mcp_list_tools: ✅ 可见 (传统模式)`);
  console.log(`     • mcp_call:       ✅ 可见 (传统模式)`);
  console.log(`     • mcp__*__*:      ❌ 不可用`);
}

// 3. 环境变量检查
console.log('\n🌍 3. 环境变量配置');
console.log('─────────────────────────────────────────────────────────────');

const envVar = process.env.OPENAWORK_DISABLE_MCP_FLAT_TOOLS;
console.log(`   OPENAWORK_DISABLE_MCP_FLAT_TOOLS: ${envVar ?? '(未设置)'}`);

if (envVar === '1') {
  console.log(`   说明: Flat MCP 模式已被禁用`);
} else if (envVar) {
  console.log(`   ⚠️  警告: 无效值 "${envVar}"，只有 "1" 会禁用 Flat 模式`);
} else {
  console.log(`   说明: 未设置，使用默认值 (Flat 模式启用)`);
}

// 4. 诊断结果和建议
console.log('\n💡 4. 诊断结果与修复建议');
console.log('─────────────────────────────────────────────────────────────');

if (flatModeEnabled) {
  console.log('   ✅ 系统工作正常 (Flat MCP 模式)');
  console.log('');
  console.log('   如果遇到 "AI_NoSuchToolError: mcp_list_tools" 错误：');
  console.log('');
  console.log('   原因：模型尝试调用被隐藏的传统 MCP 工具');
  console.log('');
  console.log('   解决方案 A（推荐）：保持 Flat 模式，修复调用方');
  console.log('     1. 清除模型缓存的旧 prompt');
  console.log('     2. 创建新会话');
  console.log('     3. 让模型使用扁平化工具名称 (mcp__<serverId>__<toolName>)');
  console.log('');
  console.log('   解决方案 B：禁用 Flat 模式（用于调试）');
  console.log('     1. 在 .env 中添加：OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1');
  console.log('     2. 重启 Gateway：pnpm --filter @openAwork/agent-gateway dev');
  console.log('     3. 模型将可以使用 mcp_list_tools 和 mcp_call');
} else {
  console.log('   ⚠️  系统运行在传统 MCP 模式');
  console.log('');
  console.log('   当前配置：');
  console.log('     • mcp_list_tools 和 mcp_call 可见');
  console.log('     • 扁平化工具不可用');
  console.log('');
  console.log('   如果想启用 Flat MCP 模式（推荐）：');
  console.log('     1. 从 .env 中移除或注释：OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1');
  console.log('     2. 重启 Gateway');
  console.log('');
  console.log('   如果遇到错误：');
  console.log('     • 检查 MCP 服务器配置是否正确');
  console.log('     • 确认服务器状态为 "connected"');
  console.log('     • 查看 Gateway 日志中的错误信息');
}

console.log('\n📚 更多信息');
console.log('─────────────────────────────────────────────────────────────');
console.log('   文档: docs/troubleshooting/mcp-tools-error.md');
console.log('   相关代码:');
console.log('     • services/agent-gateway/src/routes/stream.ts:2448-2502');
console.log('     • services/agent-gateway/src/tools/tool-sandbox.ts:2270-2284');
console.log('     • services/agent-gateway/src/mcp/mcp-tool-naming.ts:136-138');

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║            诊断完成                                            ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
