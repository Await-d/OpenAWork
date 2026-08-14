/**
 * 验证 Lint 提示词导出
 *
 * 这个脚本验证 POST_WRITE_LINT_USAGE_GUIDE 和 POST_WRITE_LINT_TOOLS_LIST
 * 可以正确从 @openAwork/agent-core 导入
 */

import {
  POST_WRITE_LINT_USAGE_GUIDE,
  POST_WRITE_LINT_TOOLS_LIST,
} from '@openAwork/agent-core';

console.log('=== Lint 提示词导出验证 ===\n');

// 验证 POST_WRITE_LINT_USAGE_GUIDE
console.log('1. POST_WRITE_LINT_USAGE_GUIDE:');
console.log('   - 类型:', typeof POST_WRITE_LINT_USAGE_GUIDE);
console.log('   - 长度:', POST_WRITE_LINT_USAGE_GUIDE.length, '字符');
console.log('   - 包含核心章节:', POST_WRITE_LINT_USAGE_GUIDE.includes('核心概念'));
console.log('   - 包含反馈格式:', POST_WRITE_LINT_USAGE_GUIDE.includes('Lint 反馈格式'));
console.log('   - 包含最佳实践:', POST_WRITE_LINT_USAGE_GUIDE.includes('最佳实践'));
console.log();

// 验证 POST_WRITE_LINT_TOOLS_LIST
console.log('2. POST_WRITE_LINT_TOOLS_LIST:');
console.log('   - 类型:', Array.isArray(POST_WRITE_LINT_TOOLS_LIST) ? 'Array' : typeof POST_WRITE_LINT_TOOLS_LIST);
console.log('   - 长度:', POST_WRITE_LINT_TOOLS_LIST.length);
console.log('   - 内容:', POST_WRITE_LINT_TOOLS_LIST);
console.log();

// 验证内容质量
const requiredSections = [
  '核心概念',
  '集成方式',
  'Lint 反馈格式',
  '处理 Lint 反馈',
  '自动修复',
  '常见 Lint 问题',
  '最佳实践',
  '配置优化',
  '错误处理',
  '常见问题',
];

console.log('3. 内容完整性检查:');
let allSectionsPresent = true;
for (const section of requiredSections) {
  const present = POST_WRITE_LINT_USAGE_GUIDE.includes(section);
  console.log(`   - ${present ? '✓' : '✗'} ${section}`);
  if (!present) allSectionsPresent = false;
}
console.log();

// 验证工具列表
console.log('4. 工具列表检查:');
console.log('   - 包含 post_write_lint:', POST_WRITE_LINT_TOOLS_LIST.includes('post_write_lint') ? '✓' : '✗');
console.log();

// 总结
console.log('=== 验证结果 ===');
console.log('导出正确:', typeof POST_WRITE_LINT_USAGE_GUIDE === 'string' && Array.isArray(POST_WRITE_LINT_TOOLS_LIST) ? '✓' : '✗');
console.log('内容完整:', allSectionsPresent ? '✓' : '✗');
console.log('工具列表正确:', POST_WRITE_LINT_TOOLS_LIST.includes('post_write_lint') ? '✓' : '✗');
console.log();

if (
  typeof POST_WRITE_LINT_USAGE_GUIDE === 'string' &&
  Array.isArray(POST_WRITE_LINT_TOOLS_LIST) &&
  allSectionsPresent &&
  POST_WRITE_LINT_TOOLS_LIST.includes('post_write_lint')
) {
  console.log('✓ 所有验证通过！');
  process.exit(0);
} else {
  console.log('✗ 验证失败！');
  process.exit(1);
}
