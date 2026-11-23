#!/usr/bin/env node
/** 只迁移已停服、已备份的数据副本；正文、密钥和远程 SSH 路径保持原样。 */
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATH_FIELDS = new Set([
  'path',
  'file',
  'filePath',
  'file_path',
  'storagePath',
  'storage_path',
  'workingDirectory',
  'workspaceRoot',
  'workspace_root',
  'workspacePath',
  'workspace_path',
  'rootPath',
  'rootDirectory',
  'cwd',
  'directory',
  'skillPath',
  'skill_path',
  'sourcePath',
  'outputPath',
  'output_path',
  'backupPath',
  'privateKeyPath',
  'executablePath',
]);
const PATH_ARRAYS = new Set(['workspaceRoots', 'workspacePaths', 'openFilePaths', 'filePaths']);
const OPAQUE_FIELDS = new Set([
  'content',
  'text',
  'prompt',
  'systemPrompt',
  'messages',
  'messages_json',
  'description',
  'summary',
  'command',
  'args',
  'env',
  'headers',
  'apiKey',
  'token',
  'secret',
  'password',
  'authorization',
  'Authorization',
  'secretRef',
]);
const WORKSPACE_MAPS = new Set([
  'openFilePathsByWorkspace',
  'activeFilePathByWorkspace',
  'editorPaneTabByWorkspace',
  'browserPreviewUrlByWorkspace',
  'browserTabsByWorkspace',
  'quickTerminalOpenByWorkspace',
  'quickTerminalActiveIdByWorkspace',
]);

/** 最长前缀优先，只接受绝对路径，不允许根目录和重叠目标造成二次迁移。 */
export function parseMappings(specs) {
  const mappings = specs.map((spec) => {
    const separator = spec.indexOf('=');
    if (separator < 1) throw new Error('映射格式必须为 /容器路径=/本机路径');
    const source = spec.slice(0, separator);
    const target = spec.slice(separator + 1);
    if (!isAbsolute(source) || !isAbsolute(target)) {
      throw new Error('路径映射必须为非根目录的绝对路径');
    }
    const from = resolve(source);
    const to = resolve(target);
    if (from === '/' || to === '/') throw new Error('不允许映射根目录');
    return { from, to };
  });
  if (new Set(mappings.map(({ from }) => from)).size !== mappings.length) {
    throw new Error('路径映射源重复');
  }
  for (const { to, from } of mappings) {
    if (to === from) throw new Error('源路径与目标路径不能相同');
    if (mappings.some((entry) => to === entry.from || to.startsWith(`${entry.from}/`))) {
      throw new Error('目标仍处于某个源路径下，无法保证重复运行安全');
    }
  }
  return mappings.sort((a, b) => b.from.length - a.from.length);
}

export function rewritePath(value, mappings) {
  if (typeof value !== 'string') return value;
  const mapping = mappings.find(({ from }) => value === from || value.startsWith(`${from}/`));
  return mapping ? mapping.to + value.slice(mapping.from.length) : value;
}

function rewriteWorkspaceKey(key, mappings) {
  // UI 本地工作区身份可带空 SSH id 的 NUL 前缀；远程身份不改。
  if (key.startsWith('\0')) return `\0${rewritePath(key.slice(1), mappings)}`;
  return key.includes('\0') ? key : rewritePath(key, mappings);
}

export function rewriteStructuredPaths(value, mappings, field = '') {
  if (typeof value === 'string') {
    return PATH_FIELDS.has(field) || PATH_ARRAYS.has(field) ? rewritePath(value, mappings) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteStructuredPaths(item, mappings, field));
  }
  if (!value || typeof value !== 'object') return value;
  if (typeof value.sshConnectionId === 'string' && value.sshConnectionId.length > 0) return value;
  const entries = Object.entries(value).map(([key, item]) => {
    if (WORKSPACE_MAPS.has(field) && key.includes('\0') && !key.startsWith('\0')) {
      return [key, item];
    }
    const nextKey = WORKSPACE_MAPS.has(field) ? rewriteWorkspaceKey(key, mappings) : key;
    let next;
    if (OPAQUE_FIELDS.has(key)) next = item;
    else if (field === 'openFilePathsByWorkspace' && Array.isArray(item)) {
      next = item.map((path) => rewritePath(path, mappings));
    } else if (field === 'activeFilePathByWorkspace') next = rewritePath(item, mappings);
    else next = rewriteStructuredPaths(item, mappings, key);
    return [nextKey, next];
  });
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error('工作区路径映射发生键冲突，请先处理重复工作区');
  }
  return Object.fromEntries(entries);
}

const TABLE_FIELDS = {
  sessions: { json: ['metadata_json'] },
  artifacts: { json: ['metadata_json'] },
  team_workspaces: { paths: ['default_working_root'] },
  memories: { paths: ['workspace_root'] },
  permission_decision_logs: { paths: ['workspace_root'] },
  chat_workspace_skill_configured: { paths: ['workspace_path'] },
  chat_workspace_skill_recommendations: { paths: ['workspace_path'] },
  chat_workspace_skill_selections: { paths: ['workspace_path'] },
  session_file_backups: { paths: ['file_path', 'storage_path'] },
  session_file_diffs: {
    paths: ['file_path', 'workspace_root'],
    json: ['backup_before_ref_json', 'backup_after_ref_json'],
  },
  session_file_review_decisions: { paths: ['file_path'] },
  snapshot_file_entries: { paths: ['file_path'] },
  session_terminals: { paths: ['cwd', 'output_path'], json: ['metadata_json'] },
  session_snapshots: { json: ['summary_json', 'files_json'] },
  session_invoked_skills: { paths: ['skill_path'] },
  installed_skills: { json: ['manifest_json'] },
  session_skill_installations: { json: ['manifest_json'] },
  session_mcp_servers: { json: ['config_json'] },
  ssh_connections: { paths: ['private_key_path'] },
  task_jobs: { json: ['recovery_json'] },
  task_parent_auto_resume_contexts: { json: ['request_data_json'] },
};
const SETTING_KEYS = new Set(['user_workspace_state_v1', 'mcp_servers']);

function tableCounts(db) {
  return Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(({ name }) => [
        name,
        db.prepare(`SELECT count(*) n FROM "${name.replaceAll('"', '""')}"`).get().n,
      ]),
  );
}

function assertIntegrity(db) {
  if (
    db
      .prepare('PRAGMA quick_check')
      .all()
      .some((row) => Object.values(row)[0] !== 'ok')
  ) {
    throw new Error('SQLite quick_check 未通过，迁移中止');
  }
}

function readJson(raw, location) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${location} 包含无效 JSON，未写入任何迁移`);
  }
}

function planDatabaseChanges(db, mappings) {
  const changes = [];
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(({ name }) => name),
  );
  for (const [table, config] of Object.entries(TABLE_FIELDS)) {
    if (!tables.has(table)) continue;
    const columns = new Set(
      db
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map(({ name }) => name),
    );
    const paths = (config.paths ?? []).filter((column) => columns.has(column));
    const json = (config.json ?? []).filter((column) => columns.has(column));
    const selected = [...paths, ...json];
    if (!selected.length) continue;
    const query = db.prepare(
      `SELECT rowid AS migration_rowid, ${selected.map((c) => `"${c}"`).join(', ')} FROM "${table}"`,
    );
    for (const row of query.iterate()) {
      for (const column of selected) {
        const raw = row[column];
        if (typeof raw !== 'string' || raw.length === 0) continue;
        let next;
        if (paths.includes(column)) next = rewritePath(raw, mappings);
        else {
          const parsed = readJson(raw, `${table}.${column}`);
          const rewritten = rewriteStructuredPaths(parsed, mappings);
          next =
            JSON.stringify(rewritten) === JSON.stringify(parsed) ? raw : JSON.stringify(rewritten);
        }
        if (next !== raw) changes.push({ table, column, rowid: row.migration_rowid, value: next });
      }
    }
  }
  if (tables.has('user_settings')) {
    for (const row of db
      .prepare('SELECT rowid AS migration_rowid, key, value FROM user_settings')
      .iterate()) {
      if (!SETTING_KEYS.has(row.key)) continue;
      const parsed = readJson(row.value, 'user_settings.value');
      const next = rewriteStructuredPaths(parsed, mappings);
      if (JSON.stringify(next) !== JSON.stringify(parsed)) {
        changes.push({
          table: 'user_settings',
          column: 'value',
          rowid: row.migration_rowid,
          value: JSON.stringify(next),
        });
      }
    }
  }
  return changes;
}

function planIndexChanges(dataDir, mappings) {
  const path = join(dataDir, 'artifacts-index.json');
  if (!existsSync(path)) return [];
  if (lstatSync(path).isSymbolicLink()) throw new Error('数据索引不能是符号链接，请复制真实文件');
  const original = readFileSync(path, 'utf8');
  const parsed = readJson(original, 'artifacts-index.json');
  if (!Array.isArray(parsed)) throw new Error('artifacts-index.json 必须为数组');
  const rewritten = rewriteStructuredPaths(parsed, mappings);
  return JSON.stringify(parsed) === JSON.stringify(rewritten)
    ? []
    : [
        {
          path,
          original,
          updated: `${JSON.stringify(rewritten, null, 2)}\n`,
        },
      ];
}

/** 工具仅更新结构化引用；文件二进制和目录副本必须由调用方提前复制。 */
export function migrateDataCopy({ dataDir, mappings, apply = false }) {
  const databasePath = join(resolve(dataDir), 'openAwork.db');
  if (!existsSync(databasePath)) throw new Error('目标数据副本缺少 openAwork.db');
  if (lstatSync(databasePath).isSymbolicLink())
    throw new Error('数据库不能是符号链接，请复制真实文件');
  if (!mappings.length) throw new Error('至少提供一条路径映射');
  const db = new DatabaseSync(databasePath, { readOnly: !apply });
  let inTransaction = false;
  const replacedIndexes = [];
  const temporaryIndexes = [];
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    // 写事务从预检开始持锁，禁止与网关或其他迁移并发写入。
    if (apply) {
      db.exec('BEGIN IMMEDIATE');
      inTransaction = true;
    }
    assertIntegrity(db);
    const before = tableCounts(db);
    const changes = planDatabaseChanges(db, mappings);
    const indexes = planIndexChanges(dataDir, mappings);
    const report = {
      mode: apply ? 'apply' : 'dry-run',
      databaseIntegrity: 'ok',
      before,
      after: before,
      changedCells: changes.length,
      changedColumns: {},
      changedIndexFiles: indexes.length,
      warnings: ['仅迁移结构化引用；历史正文内的旧路径保持不变，实际文件须预先复制。'],
    };
    for (const { table, column } of changes) {
      const key = `${table}.${column}`;
      report.changedColumns[key] = (report.changedColumns[key] ?? 0) + 1;
    }
    if (!apply) return report;
    const statements = new Map();
    for (const change of changes) {
      const key = `${change.table}.${change.column}`;
      if (!statements.has(key))
        statements.set(
          key,
          db.prepare(`UPDATE "${change.table}" SET "${change.column}"=? WHERE rowid=?`),
        );
      statements.get(key).run(change.value, change.rowid);
    }
    report.after = tableCounts(db);
    if (JSON.stringify(report.before) !== JSON.stringify(report.after))
      throw new Error('迁移前后记录数变化');
    assertIntegrity(db);
    for (const index of indexes) {
      const temporary = `${index.path}.migration-${process.pid}.tmp`;
      temporaryIndexes.push(temporary);
      writeFileSync(temporary, index.updated, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, index.path);
      replacedIndexes.push(index);
    }
    db.exec('COMMIT');
    inTransaction = false;
    return report;
  } catch (error) {
    if (inTransaction) db.exec('ROLLBACK');
    for (const index of replacedIndexes) writeFileSync(index.path, index.original, { mode: 0o600 });
    throw error;
  } finally {
    for (const path of temporaryIndexes) if (existsSync(path)) unlinkSync(path);
    db.close();
  }
}

function main(args) {
  if (args.includes('--help')) {
    console.log(`用法：node scripts/native-gateway/migration.mjs --data-dir /数据副本
  --map /容器路径=/本机路径 [--map ...] [--dry-run | --apply] [--report /报告.json]

默认只预检。执行前停止源和目标网关并保留冷备份，复制全部数据和文档。
--apply 仅修改副本中的结构化路径，不复制文件、不改历史消息正文或密钥。
JSON 索引与 SQLite 跨文件操作无法抵御进程中途被杀；异常时从冷备份重建副本。`);
    return;
  }
  let dataDir;
  let reportPath;
  let apply = false;
  const specs = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (['--data-dir', '--map', '--report'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`);
      if (arg === '--data-dir') dataDir = value;
      else if (arg === '--report') reportPath = value;
      else specs.push(value);
    } else throw new Error(`未知参数：${arg}`);
  }
  if (!dataDir) throw new Error('必须使用 --data-dir 指向已备份的数据副本');
  if (args.includes('--apply') && args.includes('--dry-run')) {
    throw new Error('--apply 与 --dry-run 不能同时指定');
  }
  if (reportPath && existsSync(reportPath)) throw new Error('报告文件已存在，请使用新路径');
  const mappings = parseMappings(specs);
  const report = migrateDataCopy({ dataDir, mappings, apply });
  const payload = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) writeFileSync(reportPath, payload, { mode: 0o600, flag: 'wx' });
  console.log(payload);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`迁移失败：${error.message}`);
    process.exitCode = 1;
  }
}
