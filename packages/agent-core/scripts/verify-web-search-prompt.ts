import {
  WEB_SEARCH_TOOL_USAGE_GUIDE,
  WEB_SEARCH_TOOLS_LIST,
  WEB_SEARCH_PROVIDERS,
} from '@openAwork/agent-core';

console.log('=== Web 搜索工具提示词验证 ===\n');

console.log('1. 工具列表:', WEB_SEARCH_TOOLS_LIST);
console.log('2. 提供商数量:', WEB_SEARCH_PROVIDERS.length);
console.log('3. 提供商列表:', WEB_SEARCH_PROVIDERS);
console.log('4. 使用指南长度:', WEB_SEARCH_TOOL_USAGE_GUIDE.length, '字符');

// 验证核心章节
const sections = [
  '基本用法',
  '搜索提供商对比',
  '搜索技巧',
  '提供商选择策略',
  '多提供商策略',
  '错误处理',
  '工作流模式',
  '性能优化建议',
  '安全和隐私',
  '常见问题',
];

console.log('\n5. 核心章节验证:');
sections.forEach((section) => {
  const hasSection = WEB_SEARCH_TOOL_USAGE_GUIDE.includes(section);
  console.log(`   ${hasSection ? '✅' : '❌'} ${section}`);
});

// 验证所有提供商都有说明
console.log('\n6. 提供商覆盖验证:');
WEB_SEARCH_PROVIDERS.forEach((provider) => {
  const hasProvider = WEB_SEARCH_TOOL_USAGE_GUIDE.toLowerCase().includes(provider);
  console.log(`   ${hasProvider ? '✅' : '❌'} ${provider}`);
});

// 验证多提供商策略
console.log('\n7. 多提供商策略验证:');
const strategies = ['Sequential', 'First-Success', 'Merge'];
strategies.forEach((strategy) => {
  const hasStrategy = WEB_SEARCH_TOOL_USAGE_GUIDE.includes(strategy);
  console.log(`   ${hasStrategy ? '✅' : '❌'} ${strategy}`);
});

console.log('\n✅ 验证完成！');
