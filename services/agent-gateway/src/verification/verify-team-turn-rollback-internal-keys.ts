/**
 * W3 守卫：网关内部请求键命名空间不得漂移。
 *
 * 两层断言：
 *   1. 注册表自证：`GATEWAY_INTERNAL_REQUEST_KEY_SHAPES` 的每个样例都必须被
 *      `isGatewayInternalRequestKey` 拒绝，且外部客户端键（随机 UUID）不被误判；
 *   2. 源码扫描：`handoff/runner/**`、`tools/**`、`routes/**` 中以模板字面量构造的
 *      请求键（显式 `clientRequestId` 赋值 / 命名含 RequestId|IdempotencyKey|RequestKey|
 *      WorkflowPlan 的 builder / `*PREFIX` 常量）必须落在某个已注册前缀之内。新增内部
 *      键形状不登记注册表 → 本脚本失败。
 *
 * 扫描边界：前缀完全由其它键拼接派生（`` `${clientRequestId}:assistant:1` ``）的写法没有
 * 静态前缀，不属于新命名空间，不触发失败。
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATEWAY_INTERNAL_REQUEST_KEY_SHAPES,
  isGatewayInternalRequestKey,
} from '../handoff/store/handoff-store.js';
import { assert } from './task-verification-helpers.js';

const SCAN_DIRS = ['handoff/runner', 'tools', 'routes', 'task'] as const;
const BUILDER_FUNCTION_NAME = /(ClientRequestId|ClientIdempotencyKey|RequestKey|WorkflowPlan)/;
const KEY_PREFIX_CONST_NAME = /(?:REQUEST|CLIENT)[A-Z_]*PREFIX[A-Z_]*/;
// 常量式前缀必须连同分隔符一起捕获（`task-parent-decision:` / `restore-apply-`），
// 否则与注册表中的带分隔符前缀做 `startsWith` 覆盖判定时会永远不匹配。
const PREFIX_CONST_VALUE = /PREFIX\w*\s*=\s*'([a-z][a-z0-9_-]*[:-]?)/;
const LITERAL_KEY_PREFIX = /`([a-z][a-z0-9-]*[:-])/;

interface DiscoveredRequestKeyPrefix {
  prefix: string;
  site: string;
}

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') {
        continue;
      }
      files.push(...listTypeScriptFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function scanFile(
  file: string,
  relativePath: string,
  discovered: DiscoveredRequestKeyPrefix[],
): void {
  const lines = readFileSync(file, 'utf8').split('\n');
  let insideKeyBuilder = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const declaration =
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?const\s+(\w+)\s*[:=(]/.exec(line);
    if (declaration) {
      insideKeyBuilder = BUILDER_FUNCTION_NAME.test(declaration[1] ?? declaration[2] ?? '');
    }
    const site = `${relativePath}:${index + 1}`;
    const prefixConstant = PREFIX_CONST_VALUE.exec(line);
    if (prefixConstant?.[1] !== undefined && KEY_PREFIX_CONST_NAME.test(line)) {
      discovered.push({ prefix: prefixConstant[1], site });
    }
    if (!line.includes('clientRequestId') && !insideKeyBuilder) {
      continue;
    }
    const literal = LITERAL_KEY_PREFIX.exec(line);
    if (literal?.[1] !== undefined) {
      discovered.push({ prefix: literal[1], site });
    }
  }
}

function collectRequestKeyPrefixes(): DiscoveredRequestKeyPrefix[] {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const discovered: DiscoveredRequestKeyPrefix[] = [];
  for (const relativeDir of SCAN_DIRS) {
    for (const file of listTypeScriptFiles(path.join(sourceRoot, relativeDir))) {
      scanFile(file, path.relative(sourceRoot, file), discovered);
    }
  }
  return discovered;
}

export function verifyInternalRequestKeyGuard(): void {
  const registeredPrefixes = GATEWAY_INTERNAL_REQUEST_KEY_SHAPES.map((shape) => shape.prefix);
  for (const shape of GATEWAY_INTERNAL_REQUEST_KEY_SHAPES) {
    assert(
      shape.prefix.length > 0,
      `internal key shape must declare a non-empty prefix (source=${shape.source})`,
    );
    assert(
      shape.sample.startsWith(shape.prefix),
      `internal key sample must start with its own prefix (prefix=${shape.prefix}, sample=${shape.sample})`,
    );
    assert(
      isGatewayInternalRequestKey(shape.sample),
      `registered internal key shape must be rejected as an own turn key (source=${shape.source}, sample=${shape.sample})`,
    );
  }
  assert(
    new Set(registeredPrefixes).size === registeredPrefixes.length,
    `internal key prefixes must be unique (${registeredPrefixes.join(', ')})`,
  );

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const externalKey = randomUUID();
    assert(
      !isGatewayInternalRequestKey(externalKey),
      `external client key must stay outside the reserved namespace (${externalKey})`,
    );
  }

  const discovered = collectRequestKeyPrefixes();
  assert(
    discovered.length > 0,
    'source scan must discover the known internal request key builders',
  );
  for (const entry of discovered) {
    const covered = registeredPrefixes.some((prefix) => entry.prefix.startsWith(prefix));
    assert(
      covered,
      `internal request key prefix "${entry.prefix}" at ${entry.site} is not registered in GATEWAY_INTERNAL_REQUEST_KEY_SHAPES`,
    );
    assert(
      isGatewayInternalRequestKey(`${entry.prefix}fixture`),
      `discovered internal request key shape at ${entry.site} must be rejected by isGatewayInternalRequestKey`,
    );
  }
}
