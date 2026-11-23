import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  migrateDataCopy,
  parseMappings,
  rewritePath,
  rewriteStructuredPaths,
} from './migration.mjs';

const directories = [];
const mappings = parseMappings(['/root/Documents=/host/documents', '/app=/host/repo']);
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'openawork-migration-'));
  directories.push(directory);
  const db = new DatabaseSync(join(directory, 'openAwork.db'));
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE sessions(id TEXT PRIMARY KEY, metadata_json TEXT, messages_json TEXT);
    CREATE TABLE session_messages(id TEXT PRIMARY KEY, content_json TEXT);
    CREATE TABLE session_file_backups(id TEXT, file_path TEXT, storage_path TEXT);
    CREATE TABLE user_settings(key TEXT, value TEXT);
    INSERT INTO users VALUES ('user');
    INSERT INTO session_messages VALUES ('message', '{"text":"/app/正文不动"}');`);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(
    'session',
    JSON.stringify({ workingDirectory: '/root/Documents/OpenAWork', summary: '/app/摘要不动' }),
    JSON.stringify([{ text: '/app/正文不动' }]),
  );
  db.prepare('INSERT INTO session_file_backups VALUES (?, ?, ?)').run(
    'backup',
    '/app/file',
    '/app/backups/1',
  );
  db.prepare('INSERT INTO user_settings VALUES (?, ?)').run(
    'providers',
    '{"apiKey":"/app/密钥不动"}',
  );
  db.close();
  return directory;
}

test('路径匹配遵循目录边界且最长前缀优先', () => {
  const map = parseMappings(['/app=/host/repo', '/app/sub=/host/sub']);
  assert.equal(rewritePath('/app/sub/file', map), '/host/sub/file');
  assert.equal(rewritePath('/app2/file', map), '/app2/file');
  assert.equal(rewritePath('查看 /app/file', map), '查看 /app/file');
  assert.equal(rewritePath('/app', map), '/host/repo');
});

test('拒绝根目录、相对路径、重复源和破坏幂等的映射', () => {
  for (const specs of [
    ['/=/', 'x=y'],
    ['app=/host'],
    ['/app=/host', '/app=/other'],
    ['/app=/app/sub'],
  ]) {
    assert.throws(() => parseMappings(specs));
  }
});

test('递归仅迁移已知路径字段；正文、命令、凭据和 SSH 路径不变', () => {
  const value = {
    workingDirectory: '/app/project',
    nested: { storagePath: '/app/store' },
    text: '/app/text',
    command: '/app/script',
    apiKey: '/app/key',
    env: { path: '/app/env' },
    prompt: { path: '/app/prompt' },
    remote: { sshConnectionId: 'ssh-1', workingDirectory: '/app/remote' },
  };
  assert.deepEqual(rewriteStructuredPaths(value, mappings), {
    ...value,
    workingDirectory: '/host/repo/project',
    nested: { storagePath: '/host/repo/store' },
  });
});

test('快照 files_json 的 file 字段和备份引用同时迁移，before/after 正文保留', () => {
  const value = [
    {
      file: '/app/a',
      before: '/app/旧正文',
      after: '/app/新正文',
      backupBeforeRef: { storagePath: '/app/backup' },
    },
  ];
  assert.deepEqual(rewriteStructuredPaths(value, mappings), [
    {
      file: '/host/repo/a',
      before: '/app/旧正文',
      after: '/app/新正文',
      backupBeforeRef: { storagePath: '/host/repo/backup' },
    },
  ]);
});

test('工作台路径映射键和打开文件列表同步迁移，URL 不改', () => {
  const value = {
    openFilePathsByWorkspace: { '/app': ['/app/a', '/app2/b'] },
    activeFilePathByWorkspace: { '/app': '/app/a' },
    browserPreviewUrlByWorkspace: { '/app': 'http://localhost/app' },
  };
  assert.deepEqual(rewriteStructuredPaths(value, mappings), {
    openFilePathsByWorkspace: { '/host/repo': ['/host/repo/a', '/app2/b'] },
    activeFilePathByWorkspace: { '/host/repo': '/host/repo/a' },
    browserPreviewUrlByWorkspace: { '/host/repo': 'http://localhost/app' },
  });
});

test('工作台路径映射键碰撞时拒绝覆盖', () => {
  assert.throws(
    () =>
      rewriteStructuredPaths(
        {
          activeFilePathByWorkspace: {
            '/app': '/app/a',
            '/host/repo': '/host/repo/b',
          },
        },
        mappings,
      ),
    /键冲突/,
  );
});

test('远程 SSH 工作区键和远程打开文件原样保留，本地空 SSH 身份同步迁移', () => {
  assert.deepEqual(
    rewriteStructuredPaths(
      {
        openFilePathsByWorkspace: {
          'ssh-1\0/app': ['/app/remote'],
          '\0/app': ['/app/local'],
        },
      },
      mappings,
    ),
    {
      openFilePathsByWorkspace: {
        'ssh-1\0/app': ['/app/remote'],
        '\0/host/repo': ['/host/repo/local'],
      },
    },
  );
});

test('默认预检不修改 SQLite 和索引；应用后保持行数和正文并且幂等', () => {
  const dataDir = fixture();
  const indexPath = join(dataDir, 'artifacts-index.json');
  const indexRaw = JSON.stringify([
    { id: 'artifact', path: '/app/artifact', content: '/app/内容' },
  ]);
  writeFileSync(indexPath, indexRaw);
  const beforeBytes = readFileSync(join(dataDir, 'openAwork.db'));
  const dryRun = migrateDataCopy({ dataDir, mappings });
  assert.equal(dryRun.changedCells, 3);
  assert.equal(dryRun.changedIndexFiles, 1);
  assert.deepEqual(readFileSync(join(dataDir, 'openAwork.db')), beforeBytes);
  assert.equal(readFileSync(indexPath, 'utf8'), indexRaw);
  const report = migrateDataCopy({ dataDir, mappings, apply: true });
  assert.deepEqual(report.before, report.after);
  const db = new DatabaseSync(join(dataDir, 'openAwork.db'), { readOnly: true });
  const session = db.prepare('SELECT * FROM sessions').get();
  assert.equal(JSON.parse(session.metadata_json).workingDirectory, '/host/documents/OpenAWork');
  assert.equal(JSON.parse(session.metadata_json).summary, '/app/摘要不动');
  assert.equal(session.messages_json, '[{"text":"/app/正文不动"}]');
  assert.equal(
    db.prepare('SELECT content_json FROM session_messages').get().content_json,
    '{"text":"/app/正文不动"}',
  );
  assert.equal(
    db.prepare('SELECT value FROM user_settings').get().value,
    '{"apiKey":"/app/密钥不动"}',
  );
  db.close();
  assert.equal(JSON.parse(readFileSync(indexPath, 'utf8'))[0].path, '/host/repo/artifact');
  assert.equal(migrateDataCopy({ dataDir, mappings, apply: true }).changedCells, 0);
});

test('无效 JSON 提前失败，SQLite 和文件均不部分写入', () => {
  const dataDir = fixture();
  writeFileSync(join(dataDir, 'artifacts-index.json'), '{broken');
  assert.throws(() => migrateDataCopy({ dataDir, mappings, apply: true }), /无效 JSON/);
  const db = new DatabaseSync(join(dataDir, 'openAwork.db'), { readOnly: true });
  assert.equal(
    JSON.parse(db.prepare('SELECT metadata_json FROM sessions').get().metadata_json)
      .workingDirectory,
    '/root/Documents/OpenAWork',
  );
  db.close();
});

test('目标路径违反唯一约束时事务回滚全部路径更新', () => {
  const dataDir = fixture();
  const db = new DatabaseSync(join(dataDir, 'openAwork.db'));
  db.exec('CREATE TABLE chat_workspace_skill_configured(workspace_path TEXT UNIQUE)');
  db.prepare('INSERT INTO chat_workspace_skill_configured VALUES (?)').run('/app');
  db.prepare('INSERT INTO chat_workspace_skill_configured VALUES (?)').run('/host/repo');
  db.close();
  assert.throws(() => migrateDataCopy({ dataDir, mappings, apply: true }), /UNIQUE/);
  const check = new DatabaseSync(join(dataDir, 'openAwork.db'), { readOnly: true });
  assert.equal(
    JSON.parse(check.prepare('SELECT metadata_json FROM sessions').get().metadata_json)
      .workingDirectory,
    '/root/Documents/OpenAWork',
  );
  check.close();
});

test('拒绝数据库符号链接，防止误写源数据库', () => {
  const dataDir = fixture();
  const dbPath = join(dataDir, 'openAwork.db');
  const sourcePath = join(dataDir, 'original.db');
  renameSync(dbPath, sourcePath);
  symlinkSync(sourcePath, dbPath);
  assert.throws(() => migrateDataCopy({ dataDir, mappings, apply: true }), /符号链接/);
});
