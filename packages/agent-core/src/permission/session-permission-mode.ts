import type { SessionPermissionMode } from '@openAwork/shared';

export type { SessionPermissionMode } from '@openAwork/shared';

/** 校验任意取值是否为合法的会话权限档位枚举（严格匹配字面量）。 */
function isSessionPermissionMode(value: unknown): value is SessionPermissionMode {
  return value === 'ask' || value === 'auto-edit' || value === 'yolo';
}

/**
 * 从会话 metadata 解析权限档位（权限阶梯的唯一入口）。
 *
 * 解析优先级：
 * 1. `permissionMode` 为合法枚举值（`ask` / `auto-edit` / `yolo`）时直接采用；
 * 2. 否则回退到历史布尔字段 `yoloMode`——仅严格等于 `true` 才视为 `yolo`；
 * 3. 其余情况返回保守档位 `ask`。
 *
 * 纯函数：不修改入参、不抛异常，可安全接收任意形状的 metadata。
 */
export function resolveSessionPermissionMode(
  metadata: Record<string, unknown>,
): SessionPermissionMode {
  const requested = metadata['permissionMode'];
  if (isSessionPermissionMode(requested)) {
    return requested;
  }
  return metadata['yoloMode'] === true ? 'yolo' : 'ask';
}

/**
 * `auto-edit` 档位自动放行的权限类别（仅文件编辑与写入）。
 * 中档位覆盖全部 `edit` + `write` 类工具，包括 `apply_patch` 的删除/移动与
 * `ast_grep_replace`（`dryRun:false`）的批量重写——语义是「文件修改已预先批准」，
 * 排除所有破坏性文件操作会让重构场景失去意义；需要收紧时靠显式 `deny` 规则
 * （deny 始终优先于档位快捷分支）。
 * 类别 id 与 `permission-categories.ts` / `tool-category-map.ts` 保持一致。
 */
export const AUTO_EDIT_PERMISSION_CATEGORIES: ReadonlySet<string> = new Set(['edit', 'write']);

/**
 * `auto-edit` 档位唯一豁免的工具：`workspace_review_revert`。
 * 它丢弃的是评审状态而非编辑内容，因此不随文件修改一并自动放行，仍需人工确认。
 */
export const AUTO_EDIT_EXCLUDED_TOOLS: ReadonlySet<string> = new Set(['workspace_review_revert']);
