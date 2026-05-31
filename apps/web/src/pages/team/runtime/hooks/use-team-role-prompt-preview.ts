/**
 * 260531-team-page · use-team-role-prompt-preview
 *
 * 为「层级角色提示词」只读预览提供数据：给定一个团队层级（TeamRoleLayer），
 * 拉取该层的 SOUL 人格（getPersona）与最终注入 system prompt 的 7 层指令栈
 * 预览（previewInstructionStack）。
 *
 * 设计要点：
 *   - 自包含：内部从 useAuthStore 读取 gatewayUrl / accessToken 并自建 client，
 *     调用方（层级对话 / 跨层线程 / 知识图谱）只需传 layer 即可，无需层层透传。
 *   - 只读：不暴露任何写接口（保存/ForceApply 仍在治理·设置里）。
 *   - 层级映射：前端有 7 层（user/reception/pm1/pm2/executor/tester/reviewer），
 *     但 SOUL 只有 5 层（reception/pm1/pm2/executor/reviewer）。user/tester
 *     没有独立 SOUL —— 返回 supported=false，UI 据此显示"该层无独立角色提示词"。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTeamPhaseAClient,
  type InstructionStackPreview,
  type LayerCapabilitySummary,
  type PersonaResponse,
  type SoulRoleLayer,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import type { TeamRoleLayer } from '../../../../stores/team/team-events.js';

const SUPPORTED_SOUL_LAYERS: ReadonlySet<TeamRoleLayer> = new Set<TeamRoleLayer>([
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
]);

/** 把前端 7 层映射到 5 层 SOUL；user/tester 无独立 SOUL，返回 null。 */
export function mapTeamLayerToSoulLayer(layer: TeamRoleLayer): SoulRoleLayer | null {
  return SUPPORTED_SOUL_LAYERS.has(layer) ? (layer as SoulRoleLayer) : null;
}

export interface TeamRolePromptPreviewState {
  /** 该层是否有独立 SOUL（user/tester 为 false）。 */
  supported: boolean;
  loading: boolean;
  error: string | null;
  /** SOUL 人格（含 effective.soulMd / isDefault）。 */
  persona: PersonaResponse | null;
  /** 7 层指令栈预览（最终注入 system prompt 的稳定块）。 */
  instructionStack: InstructionStackPreview | null;
  /** 该层能力摘要（固定工具护栏 + 默认启用 + 可派发/产物/指令）。 */
  capability: LayerCapabilitySummary | null;
  /** 重新拉取。 */
  refresh: () => void;
}

export interface UseTeamRolePromptPreviewInput {
  /** 要预览的层级；null 表示未选择（不发请求）。 */
  layer: TeamRoleLayer | null;
  /** 团队工作区 id（指令栈预览会带上，确保宪法等按工作区注入）。 */
  teamWorkspaceId?: string | null;
  /** 是否启用（面板关闭时传 false 可避免无谓请求）。 */
  enabled?: boolean;
}

export function useTeamRolePromptPreview({
  layer,
  teamWorkspaceId,
  enabled = true,
}: UseTeamRolePromptPreviewInput): TeamRolePromptPreviewState {
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);

  const client = useMemo(
    () => (gatewayUrl ? createTeamPhaseAClient(gatewayUrl) : null),
    [gatewayUrl],
  );

  const soulLayer = layer ? mapTeamLayerToSoulLayer(layer) : null;
  const supported = soulLayer !== null;

  const [persona, setPersona] = useState<PersonaResponse | null>(null);
  const [instructionStack, setInstructionStack] = useState<InstructionStackPreview | null>(null);
  const [capability, setCapability] = useState<LayerCapabilitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  // 标识当前生效的请求，避免快速切层时旧响应覆盖新数据。
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!enabled || !client || !accessToken || !soulLayer) {
      setPersona(null);
      setInstructionStack(null);
      setCapability(null);
      setLoading(false);
      setError(null);
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);

    void Promise.all([
      client.getPersonaResult(accessToken, soulLayer),
      client.previewInstructionStackResult(accessToken, {
        roleLayer: soulLayer,
        teamWorkspaceId: teamWorkspaceId ?? undefined,
      }),
      client.getLayerCapabilitiesResult(accessToken, soulLayer),
    ]).then(([personaResult, stackResult, capabilityResult]) => {
      if (seq !== requestSeqRef.current) return;

      if (personaResult.ok && personaResult.personaResponse) {
        setPersona(personaResult.personaResponse);
      } else {
        setPersona(null);
      }
      if (stackResult.ok && stackResult.preview) {
        setInstructionStack(stackResult.preview);
      } else {
        setInstructionStack(null);
      }
      if (capabilityResult.ok && capabilityResult.layers && capabilityResult.layers.length > 0) {
        setCapability(capabilityResult.layers[0] ?? null);
      } else {
        setCapability(null);
      }

      const failed = !personaResult.ok
        ? personaResult
        : !stackResult.ok
          ? stackResult
          : !capabilityResult.ok
            ? capabilityResult
            : null;
      if (failed) {
        setError(failed.errorMessage ?? '加载角色提示词失败。');
      } else {
        setError(null);
      }
      setLoading(false);
    });
  }, [enabled, client, accessToken, soulLayer, teamWorkspaceId, refreshTick]);

  return {
    supported,
    loading,
    error,
    persona,
    instructionStack,
    capability,
    refresh,
  };
}
