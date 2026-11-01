import { useEffect, useState } from 'react';
import { createAgentsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';

export interface GitHubTriggerAgentOption {
  id: string;
  label: string;
}

/**
 * GitHub 触发器表单的 Agent 候选（下拉用）。
 *
 * 分两组返回：
 *   - `agentOptions`：**已启用**的托管 Agent，正常可选；
 *   - `disabledAgentOptions`：已禁用的 Agent，仅用于给「已保存但后来被禁用」的绑定
 *     补一条带名字的说明，避免它在下拉里静默退化成「不绑定」（用户会以为绑定丢了）。
 *
 * 读取失败时两组都退化为空列表，不阻塞设置页其它内容——触发器保存本身不依赖候选列表。
 */
export function useGitHubTriggerAgentOptions(): {
  agentLoading: boolean;
  agentOptions: GitHubTriggerAgentOption[];
  disabledAgentOptions: GitHubTriggerAgentOption[];
} {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [agentOptions, setAgentOptions] = useState<GitHubTriggerAgentOption[]>([]);
  const [disabledAgentOptions, setDisabledAgentOptions] = useState<GitHubTriggerAgentOption[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      setAgentOptions([]);
      setDisabledAgentOptions([]);
      setAgentLoading(false);
      return;
    }

    let cancelled = false;
    setAgentLoading(true);

    createAgentsClient(gatewayUrl)
      .list(accessToken)
      .then((agents) => {
        if (cancelled) {
          return;
        }
        const enabledOptions: GitHubTriggerAgentOption[] = [];
        const disabledOptions: GitHubTriggerAgentOption[] = [];
        for (const agent of agents) {
          const option = { id: agent.id, label: agent.label };
          (agent.enabled ? enabledOptions : disabledOptions).push(option);
        }
        setAgentOptions(enabledOptions);
        setDisabledAgentOptions(disabledOptions);
        setAgentLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAgentOptions([]);
        setDisabledAgentOptions([]);
        setAgentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, gatewayUrl]);

  return { agentLoading, agentOptions, disabledAgentOptions };
}
