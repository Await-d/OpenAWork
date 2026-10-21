import { useEffect, useMemo } from 'react';
import { canConfigureThinkingForModel } from '@openAwork/shared-ui';
import type { ChatSettingsProvider } from '../../../../utils/chat/chat-session-defaults.js';
import { resolveEffectiveChatModelSelection } from './resolve-effective-chat-model-selection.js';

/** 会话默认值 ref 里本 hook 需要的最小结构（上游持有的是完整默认值对象）。 */
export interface ProviderModelDefaults {
  readonly modelId?: string | null;
  readonly providerId?: string | null;
}

export interface ProviderModelInfoDeps {
  providers: ChatSettingsProvider[];
  activeProviderId: string;
  activeModelId: string;
  /**
   * 会话默认 provider / model 的「最新值 ref」。
   *
   * 上游 `savedChatDefaultsRef.current` 只在**异步加载回调**里改写。调用方若在渲染期
   * 直接把 `.current` 读出来传值，React Compiler 会判定为
   * "Cannot access refs during render" 并放弃优化整个 ChatPage。改为传 ref 对象、
   * 由本 hook 在需要时读取：读取点写成「以 `deps` 为根的成员访问」
   * （`deps.chatDefaultsRef?.current?.modelId`），而不是先解构成 `chatDefaultsRef`
   * 局部名，否则会被编译器的「ref 按名字推断」判为渲染期访问 ref（见 apps/web/AGENTS.md）。
   */
  chatDefaultsRef?: React.RefObject<ProviderModelDefaults | null> | undefined;
  /**
   * 当前会话的模型绑定是否仍在加载（已有会话路由，但会话 metadata 尚未水合）。
   *
   * 会话切换会先把 provider/model 清空，随后异步拉取该会话持久化的绑定。若在这一
   * 窗口内「空选型补默认值」照常执行，晚一步到达的会话绑定就会被迫「先写默认、再被
   * 覆盖」——轻则输入框先闪出默认模型，重则在 metadata 未携带完整绑定时把全局默认
   * 模型当作会话选型落库，覆盖会话原本指定的模型。为 `true` 时必须抑制补默认值。
   */
  sessionBindingPending?: boolean | undefined;
  setActiveProviderId: (value: string) => void;
  setActiveModelId: (value: string) => void;
}

export interface ProviderModelInfoReturn {
  activeProvider: ChatSettingsProvider | undefined;
  providerCatalog: Map<string, { id: string; name: string; type: string }>;
  activeModelOption: ChatSettingsProvider['defaultModels'][number] | undefined;
  activeModelCanConfigureThinking: boolean;
  activeModelTooltip: string;
  effectiveModelId: string;
  effectiveProviderId: string;
  rawModelSelectionInvalid: boolean;
}

export function useProviderModelInfo(deps: ProviderModelInfoDeps): ProviderModelInfoReturn {
  const { activeModelId, activeProviderId, providers, setActiveModelId, setActiveProviderId } =
    deps;
  // 读出的值仍在渲染期使用（`resolveEffectiveChatModelSelection`），但读取动作是
  // 「以 `deps` 为根的成员访问」，不经过 `xxxRef` 局部名，因此不会被编译器按名字
  // 推断成渲染期访问 ref。语义与调用方在渲染期直接读 `.current` 完全一致：同一个
  // ref 对象、同一帧的 `.current`。`useMemo` 的依赖仍是读出的**值**，重算时机不变。
  const defaultModelId = deps.chatDefaultsRef?.current?.modelId ?? null;
  const defaultProviderId = deps.chatDefaultsRef?.current?.providerId ?? null;
  const effectiveSelection = useMemo(
    () =>
      resolveEffectiveChatModelSelection({
        defaultModelId,
        defaultProviderId,
        providers,
        selectedModelId: activeModelId,
        selectedProviderId: activeProviderId,
      }),
    [activeModelId, activeProviderId, defaultModelId, defaultProviderId, providers],
  );
  const activeProvider = effectiveSelection.provider ?? undefined;
  const activeModelOption = effectiveSelection.model ?? undefined;
  const providerCatalog = useMemo(
    () =>
      new Map(
        providers.map((provider) => [
          provider.id,
          { id: provider.id, name: provider.name, type: provider.type },
        ]),
      ),
    [providers],
  );
  const activeModelCanConfigureThinking = canConfigureThinkingForModel(
    activeProvider?.type,
    activeModelOption?.id ?? effectiveSelection.modelId,
    activeModelOption?.supportsThinking === true,
  );
  const activeModelTooltip = activeModelOption?.label
    ? `当前使用模型：${activeProvider?.name ? `${activeProvider.name} / ` : ''}${activeModelOption.label}${effectiveSelection.rawSelectionInvalid ? '（会话绑定模型不可用，已回退）' : ''}`
    : activeProvider?.name
      ? `当前使用提供商：${activeProvider.name}`
      : '当前使用模型';

  useEffect(() => {
    if (providers.length === 0) {
      return;
    }

    // 会话绑定仍在加载：空选型是「尚未水合」而不是「没有绑定」，此时补默认值会把
    // 全局默认模型抢先写进会话状态。交给 recovery 应用会话自己的绑定；会话确实没有
    // 绑定时，由 `shouldAdoptSessionModelSelectionDefaults` 在水合完成后统一接管。
    if (deps.sessionBindingPending === true) {
      return;
    }

    if (!activeProviderId && effectiveSelection.providerId) {
      setActiveProviderId(effectiveSelection.providerId);
    }

    if (!activeModelId && effectiveSelection.modelId) {
      setActiveModelId(effectiveSelection.modelId);
    }
  }, [
    activeModelId,
    activeProviderId,
    deps.sessionBindingPending,
    effectiveSelection.modelId,
    effectiveSelection.providerId,
    providers,
    setActiveModelId,
    setActiveProviderId,
  ]);

  return {
    activeProvider,
    providerCatalog,
    activeModelOption,
    activeModelCanConfigureThinking,
    activeModelTooltip,
    effectiveModelId: effectiveSelection.modelId,
    effectiveProviderId: effectiveSelection.providerId,
    rawModelSelectionInvalid: effectiveSelection.rawSelectionInvalid,
  };
}
