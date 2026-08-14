#!/bin/bash
# 批量修复导入路径，添加 .js 扩展名

cd packages/opencode-llm/src

# 修复所有 TypeScript 文件中的导入路径
find . -name "*.ts" -type f -exec sed -i \
  -e "s/from '\.\.\//from '..\/..\/g" \
  -e "s/from '\.\//from '.\/..\/g" \
  -e "s/\(from [\"'][^\"']*\)'/\1.js'/g" \
  -e "s/\.js\.js'/.js'/g" \
  {} +

echo "Import paths fixed"
