/**
 * 会话级技能的有效集合解析（叠加在既有 workspace/session 选择之上）。
 *
 * 与 `skill/skill-selection.ts` 的分工：
 * - `skill-selection.ts` 负责**用户级安装 + 工作区选择 + 会话覆盖**的历史语义；
 * - 本模块负责**会话级独立安装**这一新增层，并且只依赖存储层（不引入注册源 /
 *   路由依赖，避免与 `routes/skills.ts` 形成环）。
 *
 * 两种模式：
 * - `inherit`（历史兼容，老会话默认）：在既有 effective 集合之上**追加**会话级技能；
 * - `explicit`：只用会话级技能 + 内置技能，「什么都不继承」——这是渠道会话
 *   开启本能力后的默认值，用来阻断「用户级安装被渠道会话意外看见」。
 *
 * 不变式：会话**不能**禁用或替换内置技能；撤权（`enabled = 0`）永远优先于
 * pin 快照。
 */

import type { SkillManifest } from '@openAwork/skill-types';
import {
  DEFAULT_SESSION_EXTENSION_INHERITANCE,
  buildSessionSkillResourceIdentity,
  type SessionExtensionInheritanceMode,
} from './session-extension-contract.js';
import {
  computeSessionExtensionDigest,
  getSessionExtensionSettings,
  listSessionSkills,
  resolveSessionExtensionInheritance,
} from './session-extension-store.js';

/**
 * 会话技能条目在**当前时刻**是否仍然可用——撤权屏障的唯一实现。
 *
 * 为什么必须抽出来：`skill/skill-tools.ts` 与 `skill/skill-mcp-tools.ts` 曾各写一份
 * 逐字相同的五条件判断，**而且已经分叉**（一处检查条目自身的 `enabled`，另一处没查）。
 * 这类「安全判定写两遍」迟早会只剩一处是对的，所以这里是唯一实现，两个执行入口共用，
 * 测试也直接打在这里。
 *
 * 四个条件缺一不可：
 *   - `entry.enabled`：effective 快照里已被过滤掉的条目不再放行；
 *   - `manifest` 存在：没有正文的条目无法渲染，也无从校验摘要；
 *   - `current?.enabled`：库里仍是禁用态 → 拒（禁用是**立即生效**的拒绝屏障）；
 *   - 两处 `contentDigest` 一致：快照内容必须与库里当前内容同一份，防止「批准 A、执行 B」。
 *
 * `manifest` 单独入参而不是从 `entry` 里取：调用方需要在自己那一侧收窄成非空
 * （`const manifest = entry.manifest` + 本函数返回 true），否则后面用不了它。
 */
export function resolveCurrentSessionSkillManifest(params: {
  entry: { readonly enabled: boolean; readonly contentDigest?: string | undefined };
  manifest: SkillManifest | undefined;
  /** 库里当前的行；已被移除时为 `undefined`。 */
  current: { readonly enabled: boolean; readonly contentDigest: string } | undefined;
}): SkillManifest | null {
  const { entry, manifest, current } = params;
  if (!entry.enabled || !manifest || !current?.enabled) return null;
  if (current.contentDigest !== entry.contentDigest) return null;
  if (computeSessionExtensionDigest(manifest) !== current.contentDigest) return null;
  return manifest;
}

export interface SessionScopedSkillEntry {
  readonly skillId: string;
  readonly resourceRef: string;
  readonly enabled: boolean;
  readonly pinned: boolean;
  readonly manifest: SkillManifest | undefined;
  readonly contentDigest: string;
  /** 会话级资源身份：技能内嵌 MCP 复用同一身份链。 */
  readonly identity: string;
}

export interface SessionSkillLayer {
  readonly sessionId: string | null;
  readonly inheritance: SessionExtensionInheritanceMode;
  readonly entries: readonly SessionScopedSkillEntry[];
}

function asManifest(value: unknown): SkillManifest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  // 只做最小形状校验：manifest 的完整校验发生在安装时的注册源客户端。
  if (typeof record['id'] !== 'string' || typeof record['name'] !== 'string') return undefined;
  return value as SkillManifest;
}

/**
 * 读取会话级技能层。
 *
 * 无 `sessionId`（例如工具清单的纯用户级读取路径）时返回空层 + `inherit`，
 * 调用方据此走完全不变的历史逻辑。
 */
export function resolveSessionSkillLayer(sessionId: string | null): SessionSkillLayer {
  if (!sessionId) {
    return { sessionId: null, inheritance: DEFAULT_SESSION_EXTENSION_INHERITANCE, entries: [] };
  }

  const records = listSessionSkills(sessionId);
  const inheritance = resolveSessionExtensionInheritance(sessionId);
  const ownerUserId = readSessionOwnerUserId(sessionId);

  return {
    sessionId,
    inheritance,
    entries: records.map((record) => ({
      skillId: record.skillId,
      resourceRef: record.resourceRef,
      enabled: record.enabled,
      pinned: record.pinned,
      manifest: asManifest(record.manifest),
      contentDigest: record.contentDigest,
      identity: buildSessionSkillResourceIdentity({
        ownerUserId,
        sessionId,
        resourceRef: record.resourceRef,
        contentDigest: record.contentDigest,
      }),
    })),
  };
}

/** owner 参与资源身份编码，避免跨用户的同 sessionId 复用（理论上不该发生，但编码必须无歧义）。 */
function readSessionOwnerUserId(sessionId: string): string {
  return getSessionExtensionSettings(sessionId)?.ownerUserId ?? '-';
}
