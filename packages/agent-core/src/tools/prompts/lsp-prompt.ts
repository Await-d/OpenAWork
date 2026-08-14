/**
 * LSP 工具使用提示词
 *
 * 为 OpenAWork 的 10 个 LSP 工具提供详细的使用指南，包括：
 * - 使用场景说明
 * - 参数详细说明
 * - 工作流示例
 * - 错误处理指南
 * - 最佳实践
 * - 工具组合模式
 *
 * 参考: Claude Code LSPTool/prompt.ts
 */

export const LSP_TOOL_USAGE_GUIDE = `## LSP 工具使用指南

### 概述

LSP (Language Server Protocol) 工具提供强大的代码智能特性，支持跳转定义、查找引用、符号搜索、重命名等操作。

**前置条件**：
- LSP 服务器必须已配置并运行
- 文件类型需要有对应的语言服务器支持
- 位置参数使用编辑器中显示的行号（从 1 开始）和列号（从 0 开始）

---

### 核心工具

#### lsp_diagnostics - 获取诊断信息

**功能描述**：
获取 LSP 诊断信息（错误、警告、提示），可针对单个文件或全部已打开文件。

**使用场景**：
- 修改代码后检查是否引入错误
- 代码审查前验证代码质量
- CI/CD 流程中的自动化代码检查
- 重构后的全面验证

**参数说明**：
- \`filePath\` (可选): 指定文件路径，仅返回该文件的诊断；不传则返回所有文件

**最佳实践**：
1. 修改文件后先调用 \`lsp_touch\` 通知 LSP 服务器更新
2. 等待诊断更新完成（使用 \`waitForDiagnostics=true\`）
3. 调用 \`lsp_diagnostics\` 获取最新诊断结果
4. 针对单个文件使用 \`filePath\` 参数过滤，提高响应速度

**示例工作流**：
\`\`\`
场景：修改文件后检查错误
1. 编辑并保存文件 src/utils.ts
2. lsp_touch(path="src/utils.ts", waitForDiagnostics=true)
3. lsp_diagnostics(filePath="src/utils.ts")
4. 分析诊断结果，修复发现的问题
5. 重复步骤 2-4 直到无错误
\`\`\`

**注意事项**：
- 大型项目首次诊断可能需要较长时间（10-30 秒）
- 某些警告可能是误报或需要项目上下文判断
- 诊断结果依赖 LSP 服务器的索引状态
- 返回结果为 \`filePath → 诊断数组\` 的映射

#### lsp_touch - 通知文件变更

**功能描述**：
通知 LSP 服务器某个文件已被修改，触发重新分析和诊断更新。

**使用场景**：
- 代码编辑后更新 LSP 服务器状态
- 触发增量编译和类型检查
- 刷新代码智能缓存
- 确保后续查询使用最新的代码状态

**参数说明**：
- \`path\` (必需): 被修改的文件路径
- \`waitForDiagnostics\` (可选, 默认 true): 是否等待诊断更新完成后再返回

**最佳实践**：
- 关键文件修改使用 \`waitForDiagnostics=true\` 确保后续操作基于最新状态
- 批量修改多个文件时，可以先全部 touch（\`waitForDiagnostics=false\`），最后统一获取诊断
- 临时文件或测试文件可以使用 \`waitForDiagnostics=false\` 加快速度
- 在调用其他 LSP 工具前先 touch，确保分析的是最新代码

**工作流示例**：
\`\`\`
场景：批量修改多个文件
1. 修改 file1.ts, file2.ts, file3.ts
2. lsp_touch(path="file1.ts", waitForDiagnostics=false)
3. lsp_touch(path="file2.ts", waitForDiagnostics=false)
4. lsp_touch(path="file3.ts", waitForDiagnostics=true)  ← 最后一个等待
5. lsp_diagnostics()  ← 获取所有文件的诊断
\`\`\`

---

### 代码导航工具

#### lsp_goto_definition - 跳转到定义

**功能描述**：
查找符号（函数、类、变量、类型等）的定义位置。

**使用场景**：
- 理解函数/类的实现细节
- 查找类型定义
- 追踪变量声明位置
- 理解代码结构和依赖关系
- 重构前确认符号的定义范围

**参数要求**：
- \`filePath\`: 包含符号引用的文件路径
- \`line\`: 行号（从 1 开始，与编辑器显示一致）
- \`character\`: 列号（从 0 开始）

**工作流示例**：
\`\`\`
场景：查找 handleLogin 函数的定义
1. 在调用处 auth.ts:42 列 10 看到 handleLogin
2. lsp_goto_definition(
     filePath="src/auth.ts",
     line=42,
     character=10
   )
3. 返回定义位置：src/services/auth-service.ts:15
4. 阅读定义，理解实现逻辑
\`\`\`

**返回结果**：
- 单个定义：返回 \`{ filePath, line, character }\`
- 多个定义（如重载）：返回数组
- 未找到：返回空或错误提示

**注意事项**：
- 外部库的符号可能跳转到类型声明文件（.d.ts）
- TypeScript 中可能跳转到接口定义而非实现
- 某些动态符号可能无法准确定位

#### lsp_goto_implementation - 跳转到实现

**功能描述**：
查找接口或抽象方法的具体实现位置。

**使用场景**：
- 查找接口的所有实现类
- 查找抽象方法的具体重写
- 理解多态代码的实际执行路径
- 分析依赖注入的实际类型

**适用语言特性**：
- TypeScript/JavaScript: 接口实现、类继承
- Java/C#: 接口和抽象类实现
- Go: 接口实现
- Python: 抽象基类实现

**参数要求**：
- \`filePath\`: 文件路径
- \`line\`: 行号（从 1 开始）
- \`character\`: 列号（从 0 开始）

**工作流示例**：
\`\`\`
场景：查找 IAuthService 接口的实现
1. 在接口定义处或使用处定位
2. lsp_goto_implementation(
     filePath="src/interfaces/auth.ts",
     line=10,
     character=18
   )
3. 返回所有实现：
   - src/services/local-auth.ts:25
   - src/services/oauth-auth.ts:18
4. 逐个查看实现细节
\`\`\`

**与 goto_definition 的区别**：
- \`goto_definition\`: 跳转到声明/定义（接口本身）
- \`goto_implementation\`: 跳转到具体实现（实现类）

#### lsp_find_references - 查找引用

**功能描述**：
在整个工作区中查找符号的所有使用位置。

**使用场景**：
- 重构前评估影响范围
- 删除代码前确认是否还有引用
- 分析 API 的使用模式
- 查找需要同步修改的位置
- 理解代码的依赖关系

**参数说明**：
- \`filePath\`: 文件路径
- \`line\`: 行号（从 1 开始）
- \`character\`: 列号（从 0 开始）
- \`includeDeclaration\` (可选, 默认 true): 是否在结果中包含定义位置

**返回结果**：
位置数组，每个包含：
- \`filePath\`: 引用所在文件
- \`line\`: 行号
- \`character\`: 列号
- 可能包含周围代码上下文

**工作流示例**：
\`\`\`
场景：删除函数前检查引用
1. 确认要删除 legacyFunction
2. lsp_find_references(
     filePath="src/utils.ts",
     line=45,
     character=16,
     includeDeclaration=false
   )
3. 检查返回结果：
   - 如果为空：可以安全删除
   - 如果有引用：逐个检查并迁移到新方法
4. 完成迁移后再删除
\`\`\`

**注意事项**：
- 结果可能包含字符串拼接等动态引用（需人工判断）
- 注释中的符号名称不会被识别为引用
- 跨项目引用需要正确配置 workspace
- 大型项目可能返回大量结果，需要耐心分析

---

### 符号搜索工具

#### lsp_symbols - 符号列表与搜索

**功能描述**：
获取文件符号大纲或在整个工作区搜索符号。

**两种工作模式**：

**1. 文档模式** (\`scope="document"\`)：
- 获取单个文件的符号大纲
- 快速了解文件结构（类、函数、变量等）
- 适合代码导航和重构

**2. 工作区模式** (\`scope="workspace"\`)：
- 在整个项目中搜索符号
- 支持模糊匹配和驼峰缩写
- 适合快速定位代码位置

**参数说明**：
- \`filePath\`: 文件路径（文档模式必需）
- \`scope\`: "document" 或 "workspace" (默认 "document")
- \`query\` (可选): 搜索关键字（工作区模式建议使用）
- \`limit\` (可选, 默认 50, 最大 200): 限制返回结果数量

**返回的符号信息**：
- \`name\`: 符号名称
- \`kind\`: 符号类型（Function, Class, Variable, Interface 等）
- \`location\`: 位置信息（filePath, line, character）
- \`containerName\`: 所属容器（如类名）

**查询技巧**：
- **驼峰缩写**：\`query="HLC"\` 可匹配 \`HandleLoginCallback\`
- **部分匹配**：\`query="login"\` 匹配所有包含 login 的符号
- **限制结果**：使用 \`limit=20\` 避免返回过多结果
- **精确搜索**：使用完整符号名提高精确度

**工作流示例**：
\`\`\`
场景 1: 查看文件结构
lsp_symbols(
  filePath="src/services/auth.ts",
  scope="document"
)
→ 返回文件中所有类、函数、变量的大纲

场景 2: 快速定位功能
lsp_symbols(
  scope="workspace",
  query="UserAuth",
  limit=10
)
→ 在整个项目中搜索包含 UserAuth 的符号
\`\`\`

**性能优化**：
- 优先使用文档模式，速度更快
- 工作区搜索使用具体的查询词，减少匹配数量
- 合理设置 limit，避免处理过多结果

---

### 符号信息工具

#### lsp_hover - 获取悬停信息

**功能描述**：
获取指定位置符号的详细信息，包括类型签名、文档注释、参数说明等。

**使用场景**：
- 查看函数签名和参数类型
- 阅读文档注释（JSDoc/TSDoc）
- 理解变量的类型
- 快速查看 API 使用说明
- 避免跳转到定义，原地获取信息

**参数要求**：
- \`filePath\`: 文件路径
- \`line\`: 行号（从 1 开始）
- \`character\`: 列号（从 0 开始）

**返回内容**：
人类可读的文本，可能包含：
- 类型签名（TypeScript 类型、函数签名等）
- 文档注释（JSDoc、TSDoc 等）
- 参数说明和返回值说明
- 使用示例（如果文档中包含）
- 相关链接

**工作流示例**：
\`\`\`
场景：理解函数用法
1. 看到函数调用 processData(data, options)
2. lsp_hover(
     filePath="src/main.ts",
     line=120,
     character=8
   )
3. 返回：
   function processData(
     data: UserData,
     options?: ProcessOptions
   ): Promise<Result>

   处理用户数据并返回结果
   @param data - 用户数据对象
   @param options - 可选的处理选项
   @returns 处理结果的 Promise
4. 基于返回信息正确使用函数
\`\`\`

**优势**：
- 无需跳转，快速获取信息
- 适合快速查看多个符号
- 保持当前上下文

---

### 重命名工具

#### lsp_prepare_rename - 验证重命名

**功能描述**：
检查指定位置的符号是否可以重命名，并返回当前符号的范围和名称。

**使用场景**：
- **重命名前的必要验证步骤**
- 检查符号是否支持重命名
- 获取符号的当前完整名称
- 确认重命名的影响范围

**参数要求**：
- \`filePath\`: 文件路径
- \`line\`: 行号（从 1 开始）
- \`character\`: 列号（从 0 开始）

**返回结果**：
- 成功：返回符号范围和当前名称
- 失败：返回错误信息（如外部库符号、不支持重命名等）

**重要规则**：
⚠️ **在调用 \`lsp_rename\` 之前必须先调用 \`lsp_prepare_rename\` 验证**

不可重命名的情况：
- 外部库的符号（node_modules 中的代码）
- 内置类型和关键字
- 只读属性
- 某些语言服务器不支持的符号类型

**工作流示例**：
\`\`\`
场景：验证是否可以重命名
1. lsp_prepare_rename(
     filePath="src/utils.ts",
     line=25,
     character=10
   )
2. 检查返回结果：
   成功 → { range: {...}, placeholder: "oldName" }
   失败 → { error: "Cannot rename external symbol" }
3. 只有成功时才继续执行 lsp_rename
\`\`\`

#### lsp_rename - 执行重命名

**功能描述**：
在整个工作区中重命名符号，自动修改所有引用位置。

**⚠️ 危险操作警告**：
- 会直接修改多个文件
- 修改无法通过工具自动撤销（需要 git 回退）
- 可能影响大量代码
- 必须先通过 \`lsp_prepare_rename\` 验证

**使用场景**：
- 重构代码，统一命名
- 修复命名错误
- 提高代码可读性
- 符合团队命名规范

**参数说明**：
- \`filePath\`: 文件路径
- \`line\`: 行号（从 1 开始）
- \`character\`: 列号（从 0 开始）
- \`newName\`: 新的符号名称（必须符合语言命名规则）

**安全工作流**（必须遵守）：
\`\`\`
1. 【验证】lsp_prepare_rename(filePath, line, character)
   ↓
2. 【检查】确认返回成功，查看当前名称
   ↓
3. 【确认】向用户确认是否执行重命名
   ↓
4. 【执行】lsp_rename(filePath, line, character, newName="newSymbolName")
   ↓
5. 【通知】lsp_touch() 通知所有被修改的文件
   ↓
6. 【验证】lsp_diagnostics() 检查是否引入错误
   ↓
7. 【审查】如有错误，分析原因并修复
\`\`\`

**注意事项**：
- 命名必须符合语言规范（如不能以数字开头）
- 避免与现有符号冲突
- 注释中的符号名称不会被自动更新（需人工检查）
- 字符串中的符号名称不会被更新
- 重命名后建议运行完整测试

**错误恢复**：
如果重命名引入问题：
\`\`\`
1. git diff 查看所有改动
2. 人工审查修改是否正确
3. 如果有问题：git checkout . 回退所有改动
4. 分析失败原因，调整策略
\`\`\`

---

### 调用层次工具

#### lsp_call_hierarchy - 调用关系分析

**功能描述**：
分析函数/方法的调用关系，显示谁调用了它（incoming）以及它调用了谁（outgoing）。

**三种分析方向**：
- \`direction="incoming"\`: 查找**谁调用了**这个函数（调用者）
- \`direction="outgoing"\`: 查找这个函数**调用了谁**（被调用者）
- \`direction="both"\` (默认): 双向分析，同时显示调用者和被调用者

**使用场景**：
- 分析函数的影响范围
- 理解调用链路和依赖关系
- 重构前评估修改风险
- 查找未使用的函数（incoming 为空）
- 分析性能瓶颈的调用路径

**参数要求**：
- \`filePath\`: 文件路径
- \`line\`: 行号（从 1 开始）
- \`character\`: 列号（从 0 开始）
- \`direction\`: "incoming" | "outgoing" | "both" (可选, 默认 "both")

**返回信息**：
- \`incoming\`: 调用者列表（函数名、位置）
- \`outgoing\`: 被调用者列表（函数名、位置）
- 每个调用包含：函数名、文件位置、调用处的行号

**工作流示例**：
\`\`\`
场景 1: 评估函数删除影响
1. lsp_call_hierarchy(
     filePath="src/utils.ts",
     line=45,
     character=9,
     direction="incoming"
   )
2. 检查返回结果：
   - 如果 incoming 为空：该函数未被使用，可以安全删除
   - 如果有调用者：需要逐个迁移或保留

场景 2: 分析调用链路
1. lsp_call_hierarchy(
     filePath="src/api.ts",
     line=100,
     character=15,
     direction="both"
   )
2. 分析结果：
   incoming: [functionA, functionB]  ← 谁调用了它
   outgoing: [database.query, logger.log]  ← 它调用了谁
3. 理解完整的调用上下文
\`\`\`

**注意事项**：
- **只返回一跳关系**（直接调用），不会递归分析整个调用链
- 递归调用会被标记
- 动态调用（如回调、事件处理）可能无法识别
- 结果依赖于 LSP 服务器的分析能力

**性能考虑**：
- 高频调用的函数可能返回大量结果
- 建议先使用单向查询（incoming 或 outgoing）
- 需要完整分析时再使用 both

---

### 工具组合模式

掌握以下常见模式，可以高效完成复杂任务。

#### 模式 1: 代码理解流程

**目标**：快速理解陌生代码的结构和逻辑

\`\`\`
1. lsp_symbols(filePath="target.ts", scope="document")
   → 获取文件整体结构，识别关键类和函数

2. lsp_goto_definition(filePath, line, character)
   → 跳转到关键符号的定义处

3. lsp_hover(filePath, line, character)
   → 查看类型信息和文档说明

4. lsp_find_references(filePath, line, character)
   → 了解符号的使用场景和调用模式

5. lsp_call_hierarchy(filePath, line, character, direction="both")
   → 理解函数在整体架构中的位置
\`\`\`

#### 模式 2: 重构前影响评估

**目标**：在修改代码前评估影响范围和风险

\`\`\`
1. lsp_find_references(filePath, line, character)
   → 查找所有使用该符号的位置（影响范围）

2. lsp_call_hierarchy(filePath, line, character, direction="incoming")
   → 分析哪些函数依赖这个函数（依赖关系）

3. 评估影响：
   - 引用数量少且集中 → 低风险，可以直接修改
   - 引用广泛且分散 → 高风险，需要谨慎重构

4. 决策：
   - 低风险 → 直接修改
   - 高风险 → 考虑废弃旧函数，添加新函数，逐步迁移
\`\`\`

#### 模式 3: 代码修改验证工作流

**目标**：确保代码修改不引入错误

\`\`\`
1. 修改代码并保存文件

2. lsp_touch(path="modified-file.ts", waitForDiagnostics=true)
   → 通知 LSP 服务器并等待分析完成

3. lsp_diagnostics(filePath="modified-file.ts")
   → 检查修改后的错误和警告

4. 如果有错误：
   - 分析错误信息
   - 修复问题
   - 重复步骤 1-3

5. 如果无错误：
   - 运行相关测试
   - 提交代码
\`\`\`

#### 模式 4: 安全重命名工作流

**目标**：正确且安全地重命名符号

\`\`\`
1. lsp_prepare_rename(filePath, line, character)
   → 验证符号是否可以重命名

2. 检查返回结果：
   - 如果返回错误 → 停止，符号不可重命名
   - 如果成功 → 继续下一步

3. lsp_find_references(filePath, line, character)
   → 查看所有引用位置，评估影响范围

4. 【可选】向用户确认是否继续

5. lsp_rename(filePath, line, character, newName="newSymbolName")
   → 执行重命名

6. lsp_touch(path="all-modified-files", waitForDiagnostics=false)
   → 通知所有被修改的文件（可批量）

7. lsp_diagnostics()
   → 验证重命名后无错误引入

8. 如果有错误：
   - 分析错误原因
   - 手动修复或使用 git 回退
\`\`\`

#### 模式 5: 新代码集成工作流

**目标**：将新代码正确集成到现有代码库

\`\`\`
1. 编写新代码

2. lsp_symbols(scope="workspace", query="similar-name")
   → 搜索是否有重名或相似的符号（避免冲突）

3. lsp_hover() 检查新代码依赖的外部符号
   → 确认类型和用法正确

4. lsp_touch() + lsp_diagnostics()
   → 验证新代码无错误

5. 在需要的地方调用新代码

6. lsp_find_references() 验证新代码被正确引用

7. 完整测试验证
\`\`\`

#### 模式 6: 性能分析准备

**目标**：收集性能分析所需的调用关系信息

\`\`\`
1. 识别性能瓶颈函数（通过 profiler）

2. lsp_call_hierarchy(direction="incoming")
   → 找出哪些路径会调用到瓶颈函数

3. 对每个调用者重复步骤 2
   → 构建完整的调用链

4. lsp_call_hierarchy(direction="outgoing")
   → 分析瓶颈函数内部调用了什么（细化瓶颈位置）

5. 基于调用链分析优化方案
\`\`\`

---

### 常见错误处理

#### 错误 1: "No LSP server configured for this file type"

**原因**：
- 文件类型没有对应的 LSP 服务器
- LSP 服务器未启动或配置不正确

**解决方法**：
1. 检查 LSP 服务器配置
2. 确认该语言的 LSP 服务器已安装
3. 重启 LSP 服务器
4. 检查文件扩展名是否正确

#### 错误 2: "Position out of range"

**原因**：
- 行号或列号超出文件实际范围
- 文件内容与 LSP 服务器索引不同步

**解决方法**：
1. 验证行号和列号参数（行从 1 开始，列从 0 开始）
2. 确认文件未被外部修改
3. 调用 \`lsp_touch\` 同步文件状态
4. 检查是否使用了正确的文件路径

#### 错误 3: "Symbol not found at this position"

**原因**：
- 指定位置没有可识别的符号
- LSP 服务器索引未完成
- 位置在注释或字符串内部

**解决方法**：
1. 确认光标位置在符号标识符上（不是空格、注释等）
2. 等待 LSP 服务器完成索引（大型项目需要时间）
3. 尝试在符号的不同位置重试
4. 检查文件是否有语法错误影响解析

#### 错误 4: "Rename failed: symbol is from external library"

**原因**：
- 尝试重命名外部库（node_modules）中的符号
- 尝试重命名只读符号

**解决方法**：
1. 使用 \`lsp_prepare_rename\` 提前验证
2. 只重命名项目内部的符号
3. 外部库符号需要通过包装器间接重命名

#### 错误 5: "LSP server timeout"

**原因**：
- LSP 服务器响应超时
- 项目过大或查询过于复杂
- LSP 服务器崩溃或卡死

**解决方法**：
1. 检查 LSP 服务器进程状态
2. 重启 LSP 服务器
3. 对大型项目使用更具体的查询（减小范围）
4. 检查系统资源（CPU、内存）

#### 错误 6: "Diagnostics not ready"

**原因**：
- LSP 服务器仍在分析文件
- 调用 \`lsp_diagnostics\` 过快

**解决方法**：
1. 使用 \`lsp_touch(waitForDiagnostics=true)\` 等待分析完成
2. 给 LSP 服务器足够的时间完成索引
3. 大型项目首次分析可能需要 10-30 秒

---

### 性能优化建议

#### 1. 批量操作优化

**场景**：修改多个文件后检查错误

❌ **低效方式**：
\`\`\`
修改 file1.ts
lsp_touch(file1, waitForDiagnostics=true)  ← 等待
lsp_diagnostics(file1)

修改 file2.ts
lsp_touch(file2, waitForDiagnostics=true)  ← 等待
lsp_diagnostics(file2)
\`\`\`

✅ **高效方式**：
\`\`\`
修改 file1.ts, file2.ts, file3.ts
lsp_touch(file1, waitForDiagnostics=false)  ← 不等待
lsp_touch(file2, waitForDiagnostics=false)  ← 不等待
lsp_touch(file3, waitForDiagnostics=true)   ← 最后一个等待
lsp_diagnostics()  ← 一次性获取所有文件
\`\`\`

#### 2. 符号搜索优化

**场景**：在大型项目中搜索符号

❌ **低效方式**：
\`\`\`
lsp_symbols(scope="workspace")  ← 返回所有符号，数量巨大
\`\`\`

✅ **高效方式**：
\`\`\`
lsp_symbols(scope="workspace", query="UserAuth", limit=20)
← 具体查询词 + 限制数量
\`\`\`

#### 3. 避免重复查询

**场景**：多次需要同一个符号的信息

❌ **低效方式**：
\`\`\`
lsp_goto_definition(...)  ← 跳转
lsp_goto_definition(...)  ← 再次跳转到同一位置
lsp_hover(...)            ← 又查询同一符号
\`\`\`

✅ **高效方式**：
\`\`\`
result = lsp_goto_definition(...)  ← 一次查询
← 缓存结果，复用信息
lsp_hover(...)  ← 只在需要额外信息时调用
\`\`\`

#### 4. 优先使用文档模式

**场景**：查看当前文件的符号列表

❌ **低效方式**：
\`\`\`
lsp_symbols(scope="workspace", query="current-file")
← 全工作区搜索，慢
\`\`\`

✅ **高效方式**：
\`\`\`
lsp_symbols(filePath="current-file.ts", scope="document")
← 只分析单个文件，快
\`\`\`

#### 5. 合理使用 hover 代替跳转

**场景**：只需要查看类型，不需要看完整实现

❌ **低效方式**：
\`\`\`
lsp_goto_definition(...)  ← 跳转到定义
← 需要读取另一个文件，慢
\`\`\`

✅ **高效方式**：
\`\`\`
lsp_hover(...)  ← 原地获取类型和文档
← 不需要读取其他文件，快
\`\`\`

#### 6. 诊断查询范围控制

**场景**：只关心当前文件的错误

❌ **低效方式**：
\`\`\`
lsp_diagnostics()  ← 返回所有文件的诊断
← 数据量大，处理慢
\`\`\`

✅ **高效方式**：
\`\`\`
lsp_diagnostics(filePath="current-file.ts")
← 只返回当前文件，快
\`\`\`

---

### 最佳实践总结

1. **修改前验证**：重命名等危险操作必须先 prepare
2. **修改后通知**：编辑文件后立即 \`lsp_touch\`
3. **批量操作**：多文件操作时合理使用 \`waitForDiagnostics=false\`
4. **精确查询**：使用具体的查询词和 limit 参数
5. **原地获取**：优先使用 \`lsp_hover\` 而非跳转
6. **单向分析**：调用层次优先使用单向查询
7. **错误恢复**：使用 git 管理重大修改，便于回退
8. **耐心等待**：大型项目首次索引需要时间
9. **验证结果**：关键操作后必须检查 diagnostics
10. **理解限制**：了解 LSP 无法识别的情况（动态调用等）
`;

/**
 * 所有 LSP 工具名称的规范列表
 * 用于工具识别、提示词匹配和测试验证
 */
export const LSP_TOOLS_LIST = [
  'lsp_diagnostics',
  'lsp_touch',
  'lsp_goto_definition',
  'lsp_goto_implementation',
  'lsp_find_references',
  'lsp_symbols',
  'lsp_prepare_rename',
  'lsp_rename',
  'lsp_hover',
  'lsp_call_hierarchy',
] as const;

/**
 * LSP 工具名称的 TypeScript 类型
 */
export type LspToolName = (typeof LSP_TOOLS_LIST)[number];
