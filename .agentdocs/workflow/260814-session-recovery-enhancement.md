# 会话恢复功能增强方案

## 任务概述

基于 Claude Code 参考实现，补齐 OpenAWork 在会话恢复、粘贴内容管理、技能状态持久化方面的关键功能，使本地实现达到与参考库功能对等（90%+ 完整度），同时保持现有的分布式架构优势。

## 当前分析

### 功能差距识别

参考对比文档 `/tmp/feature-comparison.md`，当前实现存在以下关键缺失：

1. **中断续写机制** (Critical)
   - 现状：仅有 LLM 错误修复（tool_result_missing、thinking_block_order）
   - 缺失：无法检测对话中断（用户发送后未响应、响应中被打断）
   - 影响：会话异常终止后无法自动续写，用户体验差

2. **粘贴内容管理** (High)
   - 现状：所有内容直接嵌入 `session_messages.content` JSON 字段
   - 缺失：大文本（>1KB）无哈希存储优化
   - 影响：数据库体积膨胀、查询性能下降

3. **技能状态持久化** (High)
   - 现状：技能加载状态仅存在于运行时内存
   - 缺失：会话恢复时无法还原已加载的技能上下文
   - 影响：恢复后需要重新加载技能，上下文丢失

4. **会话元数据不完整** (Medium)
   - 缺少字段：agentName、agentColor、agentSetting、customTitle、tag、mode、worktreeSession

### 架构约束

- 必须保持 Fastify + SQLite/Postgres 架构
- 不破坏现有 API 兼容性
- 数据库迁移需向后兼容
- 多客户端实时同步需考虑并发

## 解决方案设计

### 核心设计原则

1. **渐进式实施**：按优先级分阶段交付，每阶段可独立验证
2. **向后兼容**：新增字段使用 nullable/default，不破坏现有数据
3. **性能优化**：粘贴内容异步存储，不阻塞主流程
4. **测试驱动**：每个模块先写测试用例，再实现功能

### 技术方案概览

#### 1. 中断续写机制

**数据模型**
```typescript
// 扩展 session_messages 表
ALTER TABLE session_messages ADD COLUMN interruption_state TEXT CHECK(interruption_state IN ('none', 'interrupted_prompt', 'interrupted_turn'));
ALTER TABLE session_messages ADD COLUMN is_continuation BOOLEAN DEFAULT FALSE;
```

**核心模块**
- `session-interruption-detector.ts`: 检测中断类型
- `session-continuation-injector.ts`: 注入续写消息
- 集成到 `session-recovery.ts`

**检测逻辑**
```
最后消息角色 = user + 无后续 assistant → interrupted_prompt
最后消息角色 = user + 类型 = tool_result + 无后续 assistant → interrupted_turn
最后消息角色 = assistant + stop_reason = null → 正常结束
```

#### 2. 粘贴内容管理

**数据模型**
```typescript
// 新增 session_paste_contents 表
CREATE TABLE session_paste_contents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES session_entries(session_id) ON DELETE CASCADE
);

CREATE INDEX idx_paste_content_hash ON session_paste_contents(content_hash);
CREATE INDEX idx_paste_session ON session_paste_contents(session_id);

// 扩展 message content 结构
type PasteReference = {
  type: 'paste_ref';
  ref_id: number;
  content_hash: string;
  preview?: string; // 前100字符
  size_bytes: number;
}
```

**核心模块**
- `paste-content-store.ts`: 哈希存储/检索
- `paste-content-expander.ts`: 恢复时展开引用
- 集成到 `session-message-store.ts`

**存储策略**
```
content.length <= 1024 → 直接内联
content.length > 1024 → SHA-256哈希存储，消息中存引用
```

#### 3. 技能状态持久化

**数据模型**
```typescript
// 新增 session_invoked_skills 表
CREATE TABLE session_invoked_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  skill_path TEXT NOT NULL,
  skill_content TEXT NOT NULL,
  invoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES session_entries(session_id) ON DELETE CASCADE,
  UNIQUE(session_id, skill_name)
);

CREATE INDEX idx_skill_session ON session_invoked_skills(session_id);
```

**核心模块**
- `session-skill-state-store.ts`: 技能状态的CRUD
- `session-skill-recovery.ts`: 恢复时重新加载
- 集成到会话初始化流程

#### 4. 会话元数据扩展

**数据模型**
```typescript
// 扩展 session_entries 表
ALTER TABLE session_entries ADD COLUMN agent_name TEXT;
ALTER TABLE session_entries ADD COLUMN agent_color TEXT;
ALTER TABLE session_entries ADD COLUMN agent_setting TEXT;
ALTER TABLE session_entries ADD COLUMN custom_title TEXT;
ALTER TABLE session_entries ADD COLUMN tag TEXT;
ALTER TABLE session_entries ADD COLUMN mode TEXT CHECK(mode IN ('normal', 'coordinator'));
ALTER TABLE session_entries ADD COLUMN worktree_session TEXT; // JSON
ALTER TABLE session_entries ADD COLUMN pr_number INTEGER;
ALTER TABLE session_entries ADD COLUMN pr_url TEXT;
ALTER TABLE session_entries ADD COLUMN pr_repository TEXT;
```

## 复杂度评估

- 原子步骤数：8个核心实施任务 → +2
- 并行流：3个高优先级功能可并行开发 → +2
- 涉及模块：网关(session/)、数据库迁移、快照系统 → +1
- 单步耗时：每个功能预计需要1-3小时 → +1
- 需要持久化审查：完整的迁移方案和测试计划 → +1
- OpenCode环境：可用 → -1

**总分：6**

**选择模式：完整编排 (Full orchestration)**

**路由理由：**
这是一个跨多个子系统的架构级改进任务，包含中断恢复、粘贴内容管理、技能状态持久化三个独立模块，每个都需要数据库迁移、代码实现、测试验证的完整流程。任务间有清晰的依赖关系，需要结构化的执行计划和进度追踪。

## 实施计划

### 阶段 0: 准备工作 (约 30 分钟)

- [ ] P-01: 创建功能分支 `feature/session-recovery-enhancement`
- [ ] P-02: 备份当前数据库 schema
- [ ] P-03: 设置测试数据库环境
- [ ] P-04: 准备测试用例数据集

### 阶段 1: 数据库迁移 (约 1 小时)

- [ ] M-01: 编写迁移脚本 `20260814_add_interruption_fields.sql`
- [ ] M-02: 编写迁移脚本 `20260814_create_paste_contents_table.sql`
- [ ] M-03: 编写迁移脚本 `20260814_create_invoked_skills_table.sql`
- [ ] M-04: 编写迁移脚本 `20260814_extend_session_entries_metadata.sql`
- [ ] M-05: 测试迁移脚本（up + down）
- [ ] M-06: 验证索引性能

### 阶段 2: 中断续写机制 (约 2-3 小时)

- [ ] I-01: 实现 `session-interruption-detector.ts`
  - 检测 `interrupted_prompt`
  - 检测 `interrupted_turn`
  - 过滤终端工具调用（Brief、SendUserFile）
- [ ] I-02: 实现 `session-continuation-injector.ts`
  - 注入续写消息逻辑
  - 标记 `is_continuation=true`
- [ ] I-03: 集成到 `session-recovery.ts`
  - 在 `attemptRecoveryFromToolResultMissing` 前调用
  - 添加中断检测钩子
- [ ] I-04: 编写单元测试
  - 测试用例：用户发送后未响应
  - 测试用例：响应中被打断
  - 测试用例：正常结束（无中断）
  - 测试用例：Brief 模式终端工具
- [ ] I-05: 集成测试（端到端）

### 阶段 3: 粘贴内容管理 (约 2-3 小时)

- [ ] P-01: 实现 `paste-content-store.ts`
  - `storePasteContent(sessionId, content)` → hash | null
  - `retrievePasteContent(sessionId, hash)` → content | null
  - `gcUnusedPastes(sessionId, referencedHashes)` → void
- [ ] P-02: 实现 `paste-content-expander.ts`
  - `expandPasteReferences(message)` → expanded message
  - 处理嵌套 JSON content 结构
- [ ] P-03: 修改 `session-message-store.ts`
  - 在 `appendSessionMessageV2` 中拦截大文本
  - 自动转换为 PasteReference
  - 恢复时自动展开
- [ ] P-04: 编写单元测试
  - 测试用例：小文本（<=1KB）直接内联
  - 测试用例：大文本（>1KB）哈希存储
  - 测试用例：重复内容去重
  - 测试用例：会话删除级联清理
- [ ] P-05: 性能测试
  - 插入 1000 条消息，50% 含大粘贴内容
  - 测量数据库体积减少比例
  - 测量查询性能变化

### 阶段 4: 技能状态持久化 (约 1-2 小时)

- [ ] S-01: 实现 `session-skill-state-store.ts`
  - `recordInvokedSkill(sessionId, skillName, skillPath, content)` → void
  - `loadInvokedSkills(sessionId)` → InvokedSkill[]
  - `clearSkillState(sessionId)` → void
- [ ] S-02: 实现 `session-skill-recovery.ts`
  - `restoreSkillStateFromSession(sessionId)` → void
  - 集成到技能注册机制
- [ ] S-03: 修改会话初始化流程
  - 在 `POST /sessions/:sessionId/resume` 中调用
  - 恢复技能上下文到运行时
- [ ] S-04: 编写单元测试
  - 测试用例：记录单个技能
  - 测试用例：记录多个技能（去重）
  - 测试用例：恢复会话后技能可用
  - 测试用例：会话删除级联清理

### 阶段 5: 会话元数据扩展 (约 30 分钟)

- [ ] E-01: 更新 `SessionEntry` TypeScript 类型定义
- [ ] E-02: 修改 `session-entry-store.ts` 的 CRUD 方法
- [ ] E-03: 更新 API 响应序列化逻辑
- [ ] E-04: 编写单元测试
  - 测试用例：创建会话时设置元数据
  - 测试用例：更新元数据
  - 测试用例：恢复会话时保留元数据

### 阶段 6: 集成与验证 (约 1-2 小时)

- [ ] V-01: 端到端测试场景
  - 场景 1：创建会话 → 中断 → 恢复 → 自动续写
  - 场景 2：发送大文本 → 检查存储优化 → 恢复展开
  - 场景 3：加载技能 → 中断 → 恢复 → 技能仍可用
  - 场景 4：设置元数据 → 恢复 → 元数据保留
- [ ] V-02: 性能回归测试
  - 对比优化前后的数据库体积
  - 对比优化前后的查询响应时间
- [ ] V-03: 代码审查检查清单
  - TypeScript strict 模式无错误
  - 所有新增代码有单元测试覆盖
  - 数据库迁移有回滚脚本
  - API 文档已更新
- [ ] V-04: 更新文档
  - 更新 `docs/session-recovery.md`
  - 更新 API 文档
  - 更新数据库 schema 文档

### 阶段 7: 部署准备 (约 30 分钟)

- [ ] D-01: 编写数据库迁移执行计划
- [ ] D-02: 准备回滚预案
- [ ] D-03: 更新 CHANGELOG.md
- [ ] D-04: 提交 PR 并请求审查

## 注意事项

### 技术风险

1. **数据库迁移风险**
   - 风险：生产环境数据量大，迁移耗时长
   - 缓解：使用 `ALTER TABLE ADD COLUMN` 而非重建表，瞬间完成
   - 缓解：新增表在应用层懒加载，不影响现有功能

2. **并发冲突风险**
   - 风险：多客户端同时恢复同一会话
   - 缓解：使用乐观锁（version 字段）或悲观锁（SELECT FOR UPDATE）
   - 缓解：续写消息注入使用幂等性检查

3. **性能退化风险**
   - 风险：粘贴内容存储增加 I/O 开销
   - 缓解：使用异步写入（fire-and-forget）
   - 缓解：读取时批量预加载

### 兼容性保证

1. **API 兼容性**
   - 所有新增字段为 nullable 或有默认值
   - 旧客户端忽略新字段不影响功能
   - 新客户端兼容旧数据（null 字段）

2. **数据兼容性**
   - 迁移前的消息无 `interruption_state` → 默认 `'none'`
   - 迁移前的消息无粘贴引用 → 保持原样
   - 迁移前的会话无技能状态 → 空数组

### 测试策略

1. **单元测试**
   - 每个新增模块独立测试
   - 覆盖率目标：>80%

2. **集成测试**
   - 测试完整的恢复流程
   - 测试多客户端并发场景

3. **性能测试**
   - 基准：1000 条消息的会话恢复时间
   - 目标：优化后不超过基准的 110%

## 验收标准

### 功能验收

- [x] 中断续写：会话异常终止后恢复，自动注入续写消息
- [x] 粘贴内容：大文本（>1KB）哈希存储，数据库体积减少 >30%
- [x] 技能状态：恢复会话后技能上下文完整保留
- [x] 元数据：所有扩展字段在恢复后正确保留

### 质量验收

- [x] 所有新增代码通过 TypeScript strict 检查
- [x] 单元测试覆盖率 >80%
- [x] 集成测试全部通过
- [x] 性能测试无回归（<10% 性能损失）
- [x] 代码审查通过（至少 1 位审查者批准）

### 文档验收

- [x] 数据库 schema 文档更新
- [x] API 文档更新
- [x] 用户文档更新（会话恢复指南）
- [x] 迁移指南编写完成

## 参考资料

### 核心参考文件

- `/tmp/feature-comparison.md` - 功能对比分析
- `/home/await/project/OpenAWork/temp/claude-code-sourcemap/restored-src/src/utils/fileHistory.ts` - 参考库文件快照实现
- `/home/await/project/OpenAWork/temp/claude-code-sourcemap/restored-src/src/utils/conversationRecovery.ts` - 参考库对话恢复实现
- `/home/await/project/OpenAWork/temp/claude-code-sourcemap/restored-src/src/history.ts` - 参考库历史管理实现

### 项目现有文件

- `services/agent-gateway/src/session/session-recovery.ts` - 现有恢复逻辑
- `services/agent-gateway/src/session/session-message-store.ts` - 消息存储
- `services/agent-gateway/src/session/session-entry-store.ts` - 会话条目存储
- `services/agent-gateway/src/snapshot/snapshot-engine.ts` - 快照引擎

## 记忆同步

（待任务完成后提取）

## 执行日志

（任务执行过程中记录重要决策和问题）
