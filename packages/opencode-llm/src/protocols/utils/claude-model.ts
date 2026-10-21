/**
 * Claude 模型能力判定（对齐上游 packages/ai@v2.0.28）
 *
 * 集中的原因：模型 ID 在不同宿主下形态不一（网关命名空间、Vertex 后缀、快照日期），
 * 每个协议各写一份正则就会出现「同一个模型在 Anthropic 支持、在 Bedrock 不支持」。
 * 所有判定都可用 `compatibility.*` 覆盖，避免模型名启发式成为唯一真相。
 */

import type { LLMRequest } from '../../schema/index.js';

export const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';

// 对齐参考库：接受网关命名空间与 Vertex 后缀，不把快照日期当 minor 版本。
export const claudeVersion = (id: string) => {
  const match =
    /(?:^|[./])claude-(?<family>[a-z]+)-(?<major>\d+)(?:[.-](?<minor>\d{1,2}))?(?:$|[-:@])/.exec(
      id.toLowerCase(),
    )?.groups;
  if (!match) return undefined;
  return {
    family: match['family'] ?? '',
    major: Number(match['major']),
    minor: Number(match['minor'] ?? 0),
  };
};

export const supportsThinkingBlockBinding = (model: LLMRequest['model']) => {
  const override = model.compatibility?.supportsThinkingBlockBinding;
  if (override !== undefined) return override;
  const version = claudeVersion(model.id);
  return (
    version !== undefined && (version.major > 5 || (version.major === 5 && version.minor >= 1))
  );
};

export const supportsEffortUpdates = (model: LLMRequest['model']) => {
  const override = model.compatibility?.supportsEffortUpdates;
  if (override !== undefined) return override;
  const version = claudeVersion(model.id);
  if (version === undefined) return false;
  if (version.family === 'opus') return version.major >= 5;
  if (version.family !== 'fable' && version.family !== 'mythos') return false;
  return version.major > 5 || (version.major === 5 && version.minor >= 1);
};
