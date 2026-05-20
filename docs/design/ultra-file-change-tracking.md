# OpenAWork 超强文件变更追踪方案设计

## 一、现状问题分析

### 当前架构的弱点

| 问题                               | 根因                                                        | 影响                                                |
| ---------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| **无 delta 压缩**                  | 每个版本存完整文件内容（SHA-256 去重只对完全相同内容有效）  | 10 次修改同一个 1MB 文件 → 存 10MB                  |
| **恢复依赖 SQLite 查询链**         | backup → diff → snapshot 三表 JOIN                          | 恢复路径长，任一环节数据损坏则无法恢复              |
| **无原子快照**                     | `writeFile` + `sqliteRun` 非事务性组合                      | 进程崩溃可能导致 DB 记录存在但文件缺失              |
| **workspace_reconcile 是事后补救** | 只在工具执行前后对比 git diff                               | bash 工具内的文件操作可能漏捕获                     |
| **无跨 session 恢复**              | 每个 session 独立存储，无全局时间线                         | 用户无法回到"昨天下午 3 点"的状态                   |
| **SnapshotPart/PatchPart 是空壳**  | 只存 snapshotRef 字符串，不像 opencode 存真实 git tree hash | 无法像 opencode 那样 `git checkout {hash}` 精确恢复 |

### opencode 的核心优势（我们要吸收的）

1. **git write-tree** → 原子快照，一个 hash 代表整个工作区状态
2. **git checkout {hash} -- {file}** → O(1) 精确恢复任意文件到任意版本
3. **git diff --cached {from} {to}** → 高效计算任意两个快照间的差异
4. **git pack** → delta 压缩，空间效率极高
5. **Semaphore 锁** → 并发安全

### Claude Code 的核心优势（我们要吸收的）

1. **fileHistoryTrackEdit 前置拦截** → 在写入前就备份，不依赖事后对账
2. **跨 session resume** → `copyFileHistoryForResume` 支持恢复上下文
3. **简单直接的 rewind** → 用户心智模型清晰

---

## 二、超强方案：Shadow Git + Structured Overlay

### 核心理念

```
┌─────────────────────────────────────────────────────────────┐
│                    用户工作区 (worktree)                       │
└─────────────────────────────────────────────────────────────┘
        │                                          ▲
        │ track (git write-tree)                   │ restore (git checkout)
        ▼                                          │
┌─────────────────────────────────────────────────────────────┐
│              Shadow Git Store (底层引擎)                       │
│  • 独立 .git 目录，不干扰用户的 git repo                       │
│  • 每个 step 一个 tree hash                                  │
│  • delta 压缩 + pack                                         │
│  • 7 天自动 gc                                               │
└─────────────────────────────────────────────────────────────┘
        │                                          ▲
        │ persist metadata                         │ query
        ▼                                          │
┌─────────────────────────────────────────────────────────────┐
│              Structured Overlay (上层元数据)                    │
│  • SQLite: session_snapshots, session_file_diffs             │
│  • guaranteeLevel / sourceKind / observability               │
│  • preview API / conflict detection / audit trail            │
└─────────────────────────────────────────────────────────────┘
```

**关键决策**：用 shadow git 替代当前的 file-backups 目录作为内容存储引擎，SQLite 只存元数据和索引。

---

## 三、详细设计

### 3.1 Shadow Git Store

```typescript
// services/agent-gateway/src/snapshot/shadow-git.ts

export interface ShadowGitStore {
  /** 初始化 shadow git repo（如果不存在） */
  init(workspaceRoot: string): Promise<void>;

  /**
   * 原子快照：stage 所有变更文件 → git write-tree → 返回 tree hash
   * 等价于 opencode 的 track()
   */
  capture(workspaceRoot: string, files?: string[]): Promise<TreeHash>;

  /**
   * 计算两个快照之间的差异文件列表
   * 等价于 opencode 的 patch(hash)
   */
  diff(workspaceRoot: string, from: TreeHash, to?: TreeHash): Promise<FilePatch[]>;

  /**
   * 完整 diff（含内容），用于 UI 展示
   * 等价于 opencode 的 diffFull(from, to)
   */
  diffFull(workspaceRoot: string, from: TreeHash, to: TreeHash): Promise<FileDiffContent[]>;

  /**
   * 恢复单个文件到指定快照版本
   * 比 opencode 更细粒度
   */
  restoreFile(workspaceRoot: string, hash: TreeHash, filePath: string): Promise<void>;

  /**
   * 恢复整个工作区到指定快照
   * 等价于 opencode 的 restore(snapshot)
   */
  restoreAll(workspaceRoot: string, hash: TreeHash): Promise<void>;

  /**
   * 选择性恢复：只恢复指定文件列表到指定快照
   * 超越 opencode 的能力
   */
  restoreSelective(workspaceRoot: string, hash: TreeHash, files: string[]): Promise<void>;

  /**
   * 读取指定快照中某个文件的内容（不写入磁盘）
   * 用于 preview API
   */
  readFileAt(workspaceRoot: string, hash: TreeHash, filePath: string): Promise<string | null>;

  /**
   * 垃圾回收
   */
  gc(workspaceRoot: string): Promise<void>;
}

type TreeHash = string; // git tree SHA

interface FilePatch {
  file: string;
  status: 'added' | 'deleted' | 'modified';
}

interface FileDiffContent {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
  status: 'added' | 'deleted' | 'modified';
  patch: string; // unified diff text
}
```

#### Shadow Git 目录结构

```
$OPENAWORK_DATA_DIR/
  agent-gateway/
    snapshots/                          # 替代原来的 file-backups/
      {projectId-hash}/                 # 每个项目一个 shadow git
        .git/                           # bare-like git repo
          objects/
          refs/
          config
```

#### 关键实现细节

```typescript
// 核心：capture 实现
async function capture(workspaceRoot: string, files?: string[]): Promise<TreeHash> {
  const gitdir = resolveGitDir(workspaceRoot);

  // 1. 同步 .gitignore 规则到 shadow git
  await syncExcludes(gitdir, workspaceRoot);

  // 2. 确定要 stage 的文件
  const candidates = files ?? (await listChangedFiles(gitdir, workspaceRoot));

  // 3. 过滤：忽略 .gitignore 的文件、超大文件（>2MB）、二进制文件
  const allowed = await filterCandidates(candidates, workspaceRoot);

  // 4. git add
  await gitExec([...cfg, ...args(gitdir, workspaceRoot, ['add', '--all', ...allowed])]);

  // 5. git write-tree（原子操作，返回 tree hash）
  const { stdout } = await gitExec(args(gitdir, workspaceRoot, ['write-tree']));
  return stdout.trim();
}
```

### 3.2 Structured Overlay（增强元数据层）

SQLite schema 演进：

```sql
-- 新增：snapshot_trees 表（替代 session_snapshots 的 files_json 大字段）
CREATE TABLE snapshot_trees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_request_id TEXT,
  tree_hash TEXT NOT NULL,           -- shadow git tree hash
  parent_tree_hash TEXT,             -- 上一个快照的 hash（形成链）
  scope_kind TEXT NOT NULL DEFAULT 'step',  -- step | turn | manual
  source_kind TEXT NOT NULL DEFAULT 'structured_tool_diff',
  guarantee_level TEXT NOT NULL DEFAULT 'strong',
  files_changed INTEGER NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  tool_name TEXT,
  tool_call_id TEXT,
  metadata_json TEXT,                -- observability, team context 等
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(session_id, tree_hash)
);

CREATE INDEX idx_snapshot_trees_session ON snapshot_trees(session_id, created_at DESC);
CREATE INDEX idx_snapshot_trees_request ON snapshot_trees(session_id, client_request_id);

-- 新增：snapshot_file_entries 表（每个快照涉及的文件列表，轻量索引）
CREATE TABLE snapshot_file_entries (
  snapshot_tree_id INTEGER NOT NULL REFERENCES snapshot_trees(id),
  file_path TEXT NOT NULL,
  status TEXT NOT NULL,              -- added | deleted | modified
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY(snapshot_tree_id, file_path)
);

-- 保留：session_file_diffs 表（向后兼容，但 before/after 内容改为从 shadow git 读取）
-- 保留：session_file_backups 表（降级为 fallback，当 shadow git 不可用时使用）
```

### 3.3 集成到 Stream Runtime

```typescript
// stream-model-round.ts 中的变更

// BEFORE（当前）：
const turnFileDiffs = new Map<string, FileDiffContent>();
// ... 工具执行后 collectFileDiffsFromToolOutput → mergeFileDiffs → persistSessionFileDiffs

// AFTER（新方案）：
const snapshotChain: TreeHash[] = [];

// Step 开始前：捕获基线快照
const baselineHash = await shadowGit.capture(workspaceRoot);
snapshotChain.push(baselineHash);

// 每个工具执行后：
async function afterToolExecution(toolResult) {
  // 1. 捕获当前状态
  const currentHash = await shadowGit.capture(workspaceRoot);

  // 2. 如果有变化，记录到链中
  if (currentHash !== snapshotChain.at(-1)) {
    snapshotChain.push(currentHash);

    // 3. 计算 diff（从 shadow git，不再从 tool output 提取）
    const diffs = await shadowGit.diffFull(workspaceRoot, snapshotChain.at(-2)!, currentHash);

    // 4. 持久化元数据
    await persistSnapshotTree({
      sessionId,
      userId,
      clientRequestId,
      treeHash: currentHash,
      parentTreeHash: snapshotChain.at(-2),
      scopeKind: 'step',
      sourceKind: 'structured_tool_diff',
      guaranteeLevel: 'strong', // shadow git 保证的是 strong
      filesChanged: diffs.length,
      additions: diffs.reduce((s, d) => s + d.additions, 0),
      deletions: diffs.reduce((s, d) => s + d.deletions, 0),
      toolName,
      toolCallId,
    });

    // 5. 发送 run event 到前端
    publishFileDiffEvent(diffs);
  }
}

// Turn 结束时：
const turnEndHash = snapshotChain.at(-1)!;
appendSnapshotPart({ sessionId, messageId, snapshotRef: turnEndHash });
appendPatchPart({
  sessionId,
  messageId,
  hash: turnEndHash,
  files: await shadowGit
    .diff(workspaceRoot, snapshotChain[0]!, turnEndHash)
    .then((patches) => patches.map((p) => p.file)),
});
```

### 3.4 恢复 API（超越两个参考库）

```typescript
// routes/sessions.ts - 新增恢复端点

// 1. 精确恢复到任意 step
POST /sessions/:id/restore/to-step
{
  treeHash: string;           // 目标快照
  mode: 'preview' | 'apply';
  scope: 'all' | 'selective';
  files?: string[];           // scope=selective 时指定
}

// 2. 选择性回滚（保留某些 step 的修改，回滚其他的）
POST /sessions/:id/restore/cherry-pick
{
  keep: TreeHash[];           // 要保留的快照
  revert: TreeHash[];         // 要回滚的快照
  mode: 'preview' | 'apply';
}

// 3. 跨 session 恢复（全局时间线）
POST /sessions/:id/restore/from-session
{
  sourceSessionId: string;
  treeHash: string;
  files?: string[];
  mode: 'preview' | 'apply';
}

// 4. 时间点恢复
POST /sessions/:id/restore/at-time
{
  timestamp: string;          // ISO 8601
  mode: 'preview' | 'apply';
}
```

#### 恢复流程（以 cherry-pick 为例）

```typescript
async function cherryPickRestore(input: {
  sessionId: string;
  workspaceRoot: string;
  keep: TreeHash[];
  revert: TreeHash[];
}) {
  // 1. 找到所有 revert 快照涉及的文件
  const revertFiles = new Set<string>();
  for (const hash of input.revert) {
    const parentHash = await getParentTreeHash(input.sessionId, hash);
    if (!parentHash) continue;
    const patches = await shadowGit.diff(input.workspaceRoot, parentHash, hash);
    patches.forEach((p) => revertFiles.add(p.file));
  }

  // 2. 对于每个要回滚的文件，找到它在 keep 链中的最终状态
  const targetStates = new Map<string, { hash: TreeHash; content: string }>();
  for (const file of revertFiles) {
    // 从 keep 链中找到该文件最后一次被修改的快照
    let lastKeptHash: TreeHash | null = null;
    for (const hash of input.keep) {
      const content = await shadowGit.readFileAt(input.workspaceRoot, hash, file);
      if (content !== null) lastKeptHash = hash;
    }

    if (lastKeptHash) {
      const content = await shadowGit.readFileAt(input.workspaceRoot, lastKeptHash, file);
      if (content !== null) targetStates.set(file, { hash: lastKeptHash, content });
    } else {
      // 文件在 keep 链中不存在 → 恢复到基线
      const baselineHash = await getSessionBaselineHash(input.sessionId);
      const content = await shadowGit.readFileAt(input.workspaceRoot, baselineHash, file);
      targetStates.set(file, { hash: baselineHash, content: content ?? '' });
    }
  }

  // 3. 冲突检测
  const conflicts = await detectConflicts(input.workspaceRoot, targetStates);

  // 4. 应用恢复
  await shadowGit.restoreSelective(
    input.workspaceRoot,
    // 使用最终目标状态
    targetStates,
  );

  // 5. 记录恢复操作本身
  const afterHash = await shadowGit.capture(input.workspaceRoot);
  await persistSnapshotTree({
    sessionId: input.sessionId,
    treeHash: afterHash,
    scopeKind: 'manual',
    sourceKind: 'restore_replay',
    guaranteeLevel: 'strong',
  });
}
```

### 3.5 冲突检测与预览（OpenAWork 独有优势的强化）

```typescript
interface RestorePreview {
  // 基本信息
  targetHash: TreeHash;
  filesAffected: number;
  totalAdditions: number;
  totalDeletions: number;

  // 逐文件预览
  files: Array<{
    path: string;
    status: 'will_restore' | 'conflict' | 'no_change' | 'will_delete';
    current: { exists: boolean; hash?: string };
    target: { exists: boolean; hash?: string };
    diff?: FileDiffContent; // 当前 → 目标的 diff
    conflict?: {
      reason: 'modified_since_snapshot' | 'deleted_externally' | 'created_externally';
      currentContent: string;
      targetContent: string;
      baseContent: string; // 快照时的内容
      // 三方合并建议
      mergedContent?: string;
      mergeConflicts?: number;
    };
  }>;

  // 工作区状态
  workspace: {
    hasUncommittedChanges: boolean;
    dirtyFiles: string[];
    overlappingDirtyFiles: string[]; // 与恢复目标重叠的脏文件
  };

  // 安全评估
  safety: {
    canAutoApply: boolean; // 无冲突时为 true
    requiresForce: boolean; // 有冲突但可强制
    blockers: string[]; // 不可恢复的原因
  };
}
```

### 3.6 Fallback 策略（优雅降级）

```typescript
// 当 git 不可用时（如 Windows 无 git、权限问题等），降级到当前方案

class SnapshotEngine {
  private shadowGit: ShadowGitStore | null = null;
  private fallback: LegacyFileBackupStore;

  async init(workspaceRoot: string): Promise<void> {
    try {
      this.shadowGit = new ShadowGitStoreImpl();
      await this.shadowGit.init(workspaceRoot);
    } catch (error) {
      log.warn('Shadow git unavailable, falling back to file backup store', { error });
      this.shadowGit = null;
    }
  }

  async capture(workspaceRoot: string, files?: string[]): Promise<SnapshotRef> {
    if (this.shadowGit) {
      const hash = await this.shadowGit.capture(workspaceRoot, files);
      return { type: 'git', hash, guaranteeLevel: 'strong' };
    }

    // Fallback: 使用当前的 file-backup-store
    const backupRefs = await this.fallback.captureFiles(workspaceRoot, files);
    return { type: 'backup', refs: backupRefs, guaranteeLevel: 'medium' };
  }

  get guaranteeLevel(): FileChangeGuaranteeLevel {
    return this.shadowGit ? 'strong' : 'medium';
  }
}
```

---

## 四、与当前架构的对比

| 维度       | 当前 OpenAWork                  | 新方案                            | 提升              |
| ---------- | ------------------------------- | --------------------------------- | ----------------- |
| 存储效率   | ~10x 文件大小（无 delta）       | ~1.2x（git pack delta）           | **8x 空间节省**   |
| 快照原子性 | 非原子（writeFile + sqliteRun） | git write-tree 原子               | **崩溃安全**      |
| 恢复精度   | per-request                     | per-step + per-file + cherry-pick | **10x 更细粒度**  |
| 恢复速度   | 读 SQLite → 读备份文件 → 写目标 | git checkout（内存映射）          | **~5x 更快**      |
| Diff 计算  | 自实现行比较（O(n²)）           | git diff（Myers + patience）      | **更准确 + 更快** |
| 并发安全   | 无锁                            | Semaphore per gitdir              | **安全**          |
| 跨 session | 不支持                          | 共享 shadow git repo              | **支持**          |
| 冲突检测   | hashValidation（弱）            | 三方合并 + workspace review       | **生产级**        |
| 审计追踪   | sourceKind + guaranteeLevel     | 保留 + 增加 parent_tree_hash 链   | **完整因果链**    |

---

## 五、实施路径

### Phase 1：Shadow Git 引擎（2 周）

1. 实现 `ShadowGitStore` 接口
2. 在 `stream-model-round.ts` 中 step-start/step-finish 时调用 `capture()`
3. 新增 `snapshot_trees` 表
4. 保持现有 `session_file_diffs` / `session_file_backups` 不变（双写）

### Phase 2：恢复 API 升级（1 周）

1. `restore/to-step` 使用 shadow git 恢复
2. `restore/preview` 使用 `readFileAt` + 三方冲突检测
3. 前端 UI 适配新的 preview 结构

### Phase 3：淘汰旧存储（1 周）

1. 停止写入 `session_file_backups`（读取保留向后兼容）
2. 迁移工具：将旧 backup 内容导入 shadow git
3. 清理 `file-backups/` 目录

### Phase 4：高级恢复能力（1 周）

1. cherry-pick 恢复
2. 跨 session 恢复
3. 时间点恢复
4. 全局时间线 UI

---

## 六、风险与缓解

| 风险                             | 概率 | 缓解                                            |
| -------------------------------- | ---- | ----------------------------------------------- |
| git 不可用（Windows 无 git）     | 中   | Fallback 到当前方案，guaranteeLevel 降为 medium |
| shadow git 损坏                  | 低   | 定期 `git fsck`；损坏时从 SQLite 元数据重建     |
| 大文件导致 git 慢                | 中   | 2MB 上限 + .gitignore 同步 + 二进制文件排除     |
| 并发 session 写同一个 shadow git | 中   | Semaphore 锁 + 每个 session 独立 branch         |
| 磁盘空间增长                     | 低   | 7 天 gc + pack 压缩 + 用户可配置保留策略        |

---

## 七、最终架构图

```
用户发送消息
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stream Runtime                                                  │
│                                                                  │
│  step-start:                                                     │
│    baseHash = shadowGit.capture(worktree)                       │
│                                                                  │
│  tool execution:                                                 │
│    ... 工具修改文件 ...                                           │
│    afterHash = shadowGit.capture(worktree)                      │
│    if (afterHash !== prevHash):                                  │
│      diffs = shadowGit.diffFull(prevHash, afterHash)            │
│      persistSnapshotTree(afterHash, metadata)                   │
│      publishRunEvent('file_diffs', diffs)                       │
│                                                                  │
│  step-finish:                                                    │
│    appendSnapshotPart(baseHash)                                  │
│    appendPatchPart(afterHash, changedFiles)                      │
│                                                                  │
│  turn-end:                                                       │
│    persistSessionSnapshot(turnEndHash)                           │
│    publishModifiedFilesSummary()                                 │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────┐     ┌──────────────────────────────────┐
│  Shadow Git Store     │     │  SQLite Metadata                  │
│                       │     │                                    │
│  .git/objects/        │◄───►│  snapshot_trees                   │
│    (pack + loose)     │     │    tree_hash                      │
│                       │     │    parent_tree_hash               │
│  能力:                │     │    scope_kind                     │
│  • write-tree (原子)  │     │    source_kind                    │
│  • checkout (恢复)    │     │    guarantee_level                │
│  • diff (比较)        │     │    tool_name / tool_call_id       │
│  • cat-file (读取)    │     │    created_at                     │
│  • gc (清理)          │     │                                    │
│  • pack (压缩)        │     │  snapshot_file_entries            │
└──────────────────────┘     │    file_path, status, +/- lines   │
                              └──────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Restore API                                                     │
│                                                                  │
│  • to-step:      恢复到任意 step                                 │
│  • selective:    只恢复指定文件                                    │
│  • cherry-pick:  保留某些修改，回滚其他                            │
│  • at-time:      恢复到某个时间点                                 │
│  • cross-session: 从其他 session 恢复                             │
│  • preview:      三方冲突检测 + diff 预览                         │
│  • audit:        恢复操作本身被记录为 restore_replay              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 八、与竞品的最终对比

| 能力       | opencode       | Claude Code     | **新 OpenAWork**                                |
| ---------- | -------------- | --------------- | ----------------------------------------------- |
| 存储引擎   | shadow git     | file copy       | **shadow git + fallback**                       |
| 空间效率   | ★★★★★          | ★★☆☆☆           | ★★★★★                                           |
| 恢复精度   | per-step       | per-message     | **per-step + per-file + cherry-pick**           |
| 冲突检测   | 无             | stat 比较       | **三方合并 + workspace review**                 |
| 恢复预览   | 无             | getDiffStats    | **完整 diff + safety 评估**                     |
| 审计追踪   | 无             | 无              | **parent_tree_hash 因果链 + restore_replay**    |
| 跨 session | 无             | copyForResume   | **共享 shadow git + 全局时间线**                |
| 降级策略   | 无（git 必须） | 无              | **优雅降级到 file backup**                      |
| 并发安全   | Semaphore      | 无              | **Semaphore + SQLite WAL**                      |
| 可观测性   | 无             | analytics event | **guaranteeLevel + sourceKind + observability** |

**这个方案取 opencode 的底层引擎（git 存储）+ OpenAWork 现有的上层能力（preview/audit/metadata）+ Claude Code 的用户体验理念（简单 rewind），形成三者的超集。**
