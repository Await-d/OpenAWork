#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepare, publish, validateTarget } from './frontend.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'openawork-web-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, '含空格 repo');
  const source = path.join(repo, 'apps/web/dist');
  const target = path.join(root, 'published web');
  const write = (filename, text) => {
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, text);
  };
  write(path.join(source, 'index.html'), 'new html');
  write(path.join(source, 'assets/new.js'), 'new asset');
  write(path.join(source, '.hidden'), 'dotfile');
  write(path.join(target, 'index.html'), 'old html');
  write(path.join(target, 'obsolete.js'), 'old asset');
  return { root, repo, source, target, write };
}

test('完整替换包含隐藏文件，保留旧版本，支持新目录及同源免复制', (t) => {
  const { root, source, target } = fixture(t);
  const stage = prepare(source, target);
  assert.equal(readFileSync(path.join(target, 'index.html'), 'utf8'), 'old html');
  publish(source, target, stage);
  assert.equal(readFileSync(path.join(target, 'index.html'), 'utf8'), 'new html');
  assert.equal(readFileSync(path.join(target, '.hidden'), 'utf8'), 'dotfile');
  assert.equal(readFileSync(path.join(target, 'assets/new.js'), 'utf8'), 'new asset');
  assert.equal(existsSync(path.join(target, 'obsolete.js')), false);
  assert.equal(readFileSync(path.join(`${stage}.previous`, 'index.html'), 'utf8'), 'old html');
  assert.equal(prepare(source, source), '');
  const fresh = path.join(root, 'new parent/fresh');
  publish(source, fresh, prepare(source, fresh));
  assert.equal(readFileSync(path.join(fresh, 'index.html'), 'utf8'), 'new html');
});

test('发布失败恢复原目录，复制失败清理暂存且不修改旧目录', (t) => {
  const { root, source, target } = fixture(t);
  assert.throws(() => publish(source, target, path.join(root, 'missing-stage')));
  assert.equal(readFileSync(path.join(target, 'index.html'), 'utf8'), 'old html');
  symlinkSync(path.join(root, 'missing-file'), path.join(source, 'broken-link'));
  assert.throws(() => prepare(source, target));
  assert.deepEqual(
    readdirSync(root).filter((entry) => entry.startsWith('.openawork-web-')),
    [],
  );
});

test('拒绝根目录、源码树、祖先、符号链接及普通文件目标', (t) => {
  const { root, repo, source, target, write } = fixture(t);
  const link = path.join(root, 'target-link');
  symlinkSync(target, link);
  const dangling = path.join(root, 'dangling');
  symlinkSync(path.join(root, 'absent'), dangling);
  const file = path.join(root, 'file');
  write(file, 'file');
  for (const invalid of [
    '/',
    root,
    repo,
    path.dirname(source),
    path.join(source, 'nested'),
    path.join(repo, 'apps/web/src'),
    link,
    `${link}/`,
    dangling,
    file,
    'relative',
  ]) {
    assert.throws(() => validateTarget(source, invalid), invalid);
  }
});

function deployment(t, options = {}) {
  const f = fixture(t);
  const localScripts = path.join(f.repo, 'scripts/native-gateway');
  mkdirSync(localScripts, { recursive: true });
  for (const filename of ['common.sh', 'update.sh', 'install.sh', 'frontend.mjs']) {
    cpSync(path.join(scripts, filename), path.join(localScripts, filename));
  }
  const bin = path.join(f.root, 'bin');
  mkdirSync(bin);
  const executable = (name, text) =>
    writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\nset -eu\n${text}\n`, { mode: 0o755 });
  executable('id', 'printf "1000\\n"');
  executable(
    'bun',
    `printf '%s\\n' "bun $*" >>"$TEST_LOG"
if [ -n "$TEST_BUILD_FAIL_AT" ] && [ "$*" = "$TEST_BUILD_FAIL_AT" ]; then exit 1; fi
if [[ "$*" = *'@openAwork/web build'* ]]; then
  [ "$TEST_BUILD_FAIL" != 1 ] || exit 1
  printf 'new html' >apps/web/dist/index.html
fi`,
  );
  executable(
    'systemctl',
    `printf '%s\\n' "$*" >>"$TEST_LOG"
case "$2" in
  is-active) [ -f "$TEST_ROOT/running" ] ;;
  stop)
    [ "$(cat "$TEST_TARGET/index.html")" = 'old html' ]
    if [ "$TEST_EXPECT_STAGE" = 1 ]; then
      for stage in "$TEST_ROOT"/.openawork-web-*; do [ -f "$stage/index.html" ]; done
    fi
    rm -f "$TEST_ROOT/running"
    if [ "$TEST_PUBLISH_FAIL" = 1 ]; then
      for stage in "$TEST_ROOT"/.openawork-web-*; do rm -rf -- "$stage"; done
    fi ;;
  start|restart)
    backup_env=0
    for candidate in "$TEST_ROOT/backups"/*/gateway.env; do [ -f "$candidate" ] && backup_env=1; done
    [ "$backup_env" = 1 ] || [ "$2" = restart ] || [ "$TEST_BACKUP_FAIL" = 1 ]
    touch "$TEST_ROOT/running" ;;
esac`,
  );
  executable('curl', 'exit 0');
  executable(
    'cp',
    `for destination do :; done
case "$destination" in
  */backups/*)
    [ ! -f "$TEST_ROOT/running" ]
    [ "$(cat "$TEST_TARGET/index.html")" = 'old html' ] ;;
esac
exec /bin/cp "$@"`,
  );
  executable('systemd-analyze', 'exit 0');
  executable('loginctl', 'printf "yes\\n"');
  const config = path.join(f.root, 'config');
  const envFile = path.join(config, 'gateway.env');
  const target = options.same ? f.source : f.target;
  f.write(
    envFile,
    `JWT_SECRET=${'x'.repeat(32)}\nOPENAWORK_DATA_DIR="${f.root}/data"\nOPENAWORK_BROWSER_LIVE=0\n${options.noTarget ? '' : `OPENAWORK_WEB_DIST="${target}"\n`}`,
  );
  f.write(path.join(f.repo, 'services/agent-gateway/dist/index.js'), 'backend');
  mkdirSync(path.join(f.repo, 'services/agent-gateway/dist/tools'));
  f.write(path.join(f.repo, 'services/agent-gateway/src/tools/bash.txt'), 'resource');
  f.write(path.join(f.root, 'data/openAwork.db'), 'cold database');
  if (options.running !== false) f.write(path.join(f.root, 'running'), '');
  if (options.backupFail) f.write(path.join(f.root, 'backups'), 'not a directory');
  // 预置历史备份与中断残留，验证 update.sh 会按保留策略把它们收敛掉。
  for (let index = 1; index <= (options.staleBackups ?? 0); index += 1) {
    const name = `update-2026010${index}-12000${index}-stale0${index}`;
    f.write(path.join(f.root, 'backups', name, 'openAwork.db'), `stale ${index}`);
    f.write(path.join(f.root, 'backups', name, 'gateway.env'), 'stale');
  }
  if (options.partialBackup) {
    f.write(
      path.join(f.root, 'backups', '.partial-20260101-120000-crash0', 'openAwork.db'),
      'partial',
    );
  }
  if (options.copyFail) symlinkSync(path.join(f.root, 'missing'), path.join(f.source, 'broken'));
  const envBefore = readFileSync(envFile, 'utf8');
  const result = spawnSync(
    'bash',
    [
      path.join(localScripts, options.install ? 'install.sh' : 'update.sh'),
      ...(options.skip ? ['--skip-build'] : []),
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: f.root,
        XDG_CONFIG_HOME: path.join(f.root, 'xdg-config'),
        NATIVE_GATEWAY_CONFIG_DIR: config,
        NATIVE_GATEWAY_BACKUP_DIR: path.join(f.root, 'backups'),
        TEST_ROOT: f.root,
        TEST_TARGET: f.target,
        TEST_LOG: path.join(f.root, 'commands'),
        TEST_BUILD_FAIL: options.buildFail ? '1' : '0',
        TEST_BUILD_FAIL_AT: options.buildFailAt ?? '',
        TEST_PUBLISH_FAIL: options.publishFail ? '1' : '0',
        TEST_BACKUP_FAIL: options.backupFail ? '1' : '0',
        TEST_EXPECT_STAGE: !options.skip && !options.same && !options.noTarget ? '1' : '0',
      },
    },
  );
  assert.equal(readFileSync(envFile, 'utf8'), envBefore);
  return { ...f, result, log: readFileSync(path.join(f.root, 'commands'), 'utf8') };
}

for (const options of [
  {},
  { running: false },
  { same: true },
  { noTarget: true },
  { install: true },
]) {
  test(`正常构建发布：${JSON.stringify(options)}`, (t) => {
    const f = deployment(t, options);
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.match(f.log, /bun run --filter @openAwork\/web build/);
    const target = options.same || options.noTarget ? f.source : f.target;
    assert.equal(readFileSync(path.join(target, 'index.html'), 'utf8'), 'new html');
    if (!options.install) {
      const backups = path.join(f.root, 'backups');
      assert.equal(
        readFileSync(path.join(backups, readdirSync(backups)[0], 'openAwork.db'), 'utf8'),
        'cold database',
      );
    }
    if (options.running === false) assert.doesNotMatch(f.log, /--user start /);
  });
}

for (const install of [false, true]) {
  test(`跳过构建不发布：install=${install}`, (t) => {
    const f = deployment(t, { skip: true, install });
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.doesNotMatch(f.log, /bun /);
    assert.equal(readFileSync(path.join(f.target, 'index.html'), 'utf8'), 'old html');
    assert.deepEqual(
      readdirSync(f.root).filter((entry) => entry.startsWith('.openawork-web-')),
      [],
    );
  });
}

for (const options of [
  { buildFail: true },
  { buildFailAt: 'install --frozen-lockfile' },
  { buildFailAt: 'run --filter ./packages/* build' },
  { buildFailAt: 'run --filter @openAwork/agent-gateway build' },
  { copyFail: true },
  { publishFail: true },
  { publishFail: true, running: false },
  { backupFail: true },
]) {
  test(`失败时保护旧前端和服务状态：${JSON.stringify(options)}`, (t) => {
    const f = deployment(t, options);
    assert.notEqual(f.result.status, 0);
    assert.equal(readFileSync(path.join(f.target, 'index.html'), 'utf8'), 'old html');
    if (options.buildFail || options.buildFailAt || options.copyFail) {
      assert.doesNotMatch(f.log, /--user stop /);
    }
    assert.equal(existsSync(path.join(f.root, 'running')), options.running !== false);
    assert.deepEqual(
      readdirSync(f.root).filter((entry) => entry.startsWith('.openawork-web-')),
      [],
    );
  });
}

test('重复发布只保留最新一份旧前端，并清理中断残留的暂存目录', (t) => {
  const { root, source, target, write } = fixture(t);
  write(path.join(root, '.openawork-web-leftover', 'index.html'), 'stale stage');
  for (let round = 1; round <= 3; round += 1) {
    write(path.join(source, 'index.html'), `html ${round}`);
    publish(source, target, prepare(source, target));
  }
  const backups = readdirSync(root).filter((entry) => entry.startsWith('.openawork-web-'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /\.previous$/);
  // 保留的是「上一版」而不是最初版本：每次发布都把回滚点前移一格。
  assert.equal(readFileSync(path.join(root, backups[0], 'index.html'), 'utf8'), 'html 2');
  assert.equal(existsSync(path.join(root, '.openawork-web-leftover')), false);
});

test('更新按保留策略收敛历史备份与半成品', (t) => {
  const f = deployment(t, { staleBackups: 3, partialBackup: true });
  assert.equal(f.result.status, 0, f.result.stderr);
  const backups = path.join(f.root, 'backups');
  const entries = readdirSync(backups);
  assert.equal(entries.filter((entry) => entry.startsWith('update-')).length, 1);
  assert.equal(entries.filter((entry) => entry.startsWith('.partial-')).length, 0);
  assert.equal(
    readFileSync(path.join(backups, entries[0], 'openAwork.db'), 'utf8'),
    'cold database',
  );
});

test('更新失败同样收敛备份数量', (t) => {
  const f = deployment(t, { publishFail: true, staleBackups: 3, partialBackup: true });
  assert.notEqual(f.result.status, 0);
  const backups = path.join(f.root, 'backups');
  const entries = readdirSync(backups);
  assert.equal(entries.filter((entry) => entry.startsWith('update-')).length, 1);
  assert.equal(entries.filter((entry) => entry.startsWith('.partial-')).length, 0);
});
