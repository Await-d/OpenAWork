/**
 * OpenCode LLM 集成测试
 *
 * 在 agent-gateway 环境中测试 opencode-llm 包
 */

import { exampleUsage } from './opencode-llm-example.js';

async function main() {
  try {
    await exampleUsage();
    console.log('\n✅ Agent Gateway 集成测试成功!');
  } catch (error) {
    console.error('\n❌ 集成测试失败:');
    console.error(error);
    process.exit(1);
  }
}

main();
