// 修改顶层 reasoning effort 会让 provider 的提示缓存整体失效。支持原生
// 「逐消息 effort 更新」的协议（Anthropic Messages）把顶层 effort 冻结在
// 首个标记的 `previous`，并将 `Message.effort(...)` 标记降级为原生更新；
// 其余路由在编译期剥离这些标记。
import { LLMRequest, type EffortPart, type Message } from './schema/index.js';

/** 提取「effort 变化」标记消息（system 角色、仅含一个 effort part）。 */
export const effortUpdate = (message: Message): EffortPart | undefined => {
  if (message.role !== 'system' || message.content.length !== 1) return undefined;
  const part = message.content[0];
  return part?.type === 'effort' ? part : undefined;
};

export const stripEffortUpdates = (request: LLMRequest) => {
  const messages = request.messages.filter((message) => effortUpdate(message) === undefined);
  return messages.length === request.messages.length
    ? request
    : LLMRequest.update(request, { messages });
};

export const applyEffortUpdates = (request: LLMRequest): LLMRequest =>
  request.model.route.supportsEffortUpdates?.(request) ? request : stripEffortUpdates(request);

/**
 * 解析时序 effort 更新：回退 / 分叉的历史可能让最后一个标记与请求的 effort
 * 不一致——此时剥离全部标记并保持顶层 effort，避免发出互相矛盾的两份声明。
 */
export const resolveEffortUpdates = (request: LLMRequest, current: string | undefined) => {
  const updates = request.messages.flatMap((message) => effortUpdate(message) ?? []);
  if (updates.length === 0) return { request, effort: current };
  if (updates.at(-1)?.effort !== current)
    return { request: stripEffortUpdates(request), effort: current };
  return { request, effort: updates[0]?.previous };
};

export * as EffortUpdates from './effort-updates.js';
