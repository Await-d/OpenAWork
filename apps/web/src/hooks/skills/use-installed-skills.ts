/**
 * 已安装技能共享状态 Hook——`/skills` 页与「设置 → 插件 → 技能」面板共用。
 *
 * 历史上两处各写了一套「加载 / 启停 / 卸载 / 检查更新」逻辑（含乐观更新与
 * 回滚），容易出现行为漂移。这里统一为唯一事实来源：消费方只负责渲染，
 * 不再复制数据流。
 *
 * 约定：
 *   - 挂载即加载（与设置的 MCP hook 行为一致，请求成本为本地 SQLite 单查询）；
 *   - 启停走乐观更新 + 失败回滚 + 最终以服务端为准重载；
 *   - 所有失败都记录日志并暴露可读 `error`（禁止静默吞掉）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSkillsClient } from '@openAwork/web-client';
import type { MarketInstalledSkill } from '@openAwork/shared-ui';
import { useAuthStore } from '../../stores/auth/auth.js';
import { logger } from '../../utils/log/logger.js';
import { DEFAULT_PREINSTALLED_SKILL_IDS } from '../../pages/skills/shared/skills-shared-constants.js';

interface InstalledSkillDto {
  skillId: string;
  manifest: { name: string; version: string };
  sourceId: string;
  enabled: boolean;
  latestVersion?: string | null;
}

export interface SkillResyncSummary {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export interface UseInstalledSkillsResult {
  skills: MarketInstalledSkill[];
  /** 首次加载是否完成（用于骨架/空态判定）。 */
  loaded: boolean;
  /** 是否有变更请求在途（启停 / 卸载 / 检查更新）。 */
  busy: boolean;
  error: string | null;
  statusMessage: string | null;
  reload: () => Promise<void>;
  toggle: (skillId: string, nextEnabled: boolean) => Promise<void>;
  uninstall: (skillId: string) => Promise<void>;
  /** 系统目录重扫；失败返回 null。 */
  resync: () => Promise<SkillResyncSummary | null>;
  /** 系统目录重扫 + 重载列表（并写入状态提示）。 */
  checkUpdates: () => Promise<void>;
  dismissError: () => void;
}

function mapInstalledSkill(skill: InstalledSkillDto): MarketInstalledSkill {
  return {
    id: skill.skillId,
    name: skill.manifest.name,
    version: skill.manifest.version,
    // 后台周期性检查会写入真实远端版本；尚未检查过时回落到本地版本。
    latestVersion: skill.latestVersion ?? skill.manifest.version,
    source: skill.sourceId,
    enabled: skill.enabled,
    preinstalled: DEFAULT_PREINSTALLED_SKILL_IDS.has(skill.skillId),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useInstalledSkills(): UseInstalledSkillsResult {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const accessToken = useAuthStore((s) => s.accessToken);
  const client = useMemo(() => createSkillsClient(gatewayUrl), [gatewayUrl]);

  const [skills, setSkills] = useState<MarketInstalledSkill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = (await client.listInstalled(accessToken)) as { skills: InstalledSkillDto[] };
      setSkills(data.skills.map(mapInstalledSkill));
      setError(null);
    } catch (err) {
      const message = errorMessage(err);
      logger.error('installed-skills.load-failed', { error: message });
      setError(`加载失败：${message}`);
    } finally {
      setLoaded(true);
    }
  }, [accessToken, client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = useCallback(
    async (skillId: string, nextEnabled: boolean) => {
      // 乐观更新：先翻转，失败回滚；成功后再静默重载，防止并发系统重扫
      // 导致的本地与服务端状态不一致。
      setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, enabled: nextEnabled } : s)));
      setBusy(true);
      try {
        await client.setEnabled(accessToken ?? '', skillId, nextEnabled);
        setStatusMessage(`已${nextEnabled ? '启用' : '禁用'}：${skillId}`);
        void reload();
      } catch (err) {
        const message = errorMessage(err);
        logger.error('installed-skills.toggle-failed', { skillId, error: message });
        setError(`切换失败：${message}`);
        setSkills((prev) =>
          prev.map((s) => (s.id === skillId ? { ...s, enabled: !nextEnabled } : s)),
        );
      } finally {
        setBusy(false);
      }
    },
    [accessToken, client, reload],
  );

  const uninstall = useCallback(
    async (skillId: string) => {
      setBusy(true);
      try {
        await client.uninstall(accessToken ?? '', skillId);
        setStatusMessage(`已移除：${skillId}`);
        await reload();
      } catch (err) {
        const message = errorMessage(err);
        logger.error('installed-skills.uninstall-failed', { skillId, error: message });
        setError(`移除失败：${message}`);
      } finally {
        setBusy(false);
      }
    },
    [accessToken, client, reload],
  );

  const resync = useCallback(async (): Promise<SkillResyncSummary | null> => {
    if (!accessToken) return null;
    try {
      return (await client.resyncSystem(accessToken)) as SkillResyncSummary;
    } catch (err) {
      logger.error('installed-skills.resync-failed', { error: errorMessage(err) });
      return null;
    }
  }, [accessToken, client]);

  const checkUpdates = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatusMessage(null);
    try {
      // 先重扫系统目录（如 ~/.claude/skills），让新增/改动立即出现在列表中；
      // 重扫失败不阻塞列表刷新。
      const summary = await resync();
      if (summary) {
        setStatusMessage(
          `系统目录扫描完成：新增 ${summary.added}，更新 ${summary.updated}，移除 ${summary.removed}（共 ${summary.total}）`,
        );
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload, resync]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    skills,
    loaded,
    busy,
    error,
    statusMessage,
    reload,
    toggle,
    uninstall,
    resync,
    checkUpdates,
    dismissError,
  };
}
