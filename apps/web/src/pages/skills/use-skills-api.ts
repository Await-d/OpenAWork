/**
 * `/skills` 页的市场 / 本地工作区 / 注册源 / 详情数据访问。
 *
 * 从 `SkillsPage.tsx` 抽出（原 876 行单文件），已安装技能的启停与卸载
 * 改由共享 hook `useInstalledSkills` 负责，这里只保留市场侧能力。
 */

import { useCallback, useMemo } from 'react';
import { createSkillsClient } from '@openAwork/web-client';
import type { MarketSkill, MarketSkillDetail, RegistrySource } from '@openAwork/shared-ui';
import { useAuthStore } from '../../stores/auth/auth.js';

export const MARKET_PAGE_SIZE = 24;

export interface SkillEntryDto {
  id: string;
  name?: string;
  displayName?: string;
  version?: string;
  description?: string;
  category?: string;
  tags?: string[];
  downloads?: number;
  verified?: boolean;
  sourceId?: string;
  author?: string;
  readme?: string;
  permissions?: string[];
  changelog?: string;
}

export interface MarketSearchResult {
  skills: MarketSkill[];
  sourceMap: Map<string, string>;
  total: number;
}

export interface LocalSkillEntryDto extends SkillEntryDto {
  dirPath: string;
  manifestPath: string;
  workspaceRelativePath: string;
  installed?: boolean;
}

export type LocalWorkspaceSkill = (MarketSkill & Partial<MarketSkillDetail>) & {
  dirPath: string;
  manifestPath: string;
  workspaceRelativePath: string;
};

export function toMarketSkill(entry: SkillEntryDto): MarketSkill & Partial<MarketSkillDetail> {
  const installable = entry.sourceId !== 'builtin';
  return {
    id: entry.id,
    name: entry.displayName ?? entry.name ?? entry.id,
    version: entry.version ?? '0.0.0',
    description: entry.description ?? '',
    category: entry.category ?? 'other',
    tags: entry.tags ?? [],
    downloads: entry.downloads ?? 0,
    verified: entry.verified ?? false,
    installable,
    author: entry.author,
    readme: entry.readme,
    permissions: entry.permissions,
    changelog: entry.changelog,
  };
}

export function toLocalSkill(entry: LocalSkillEntryDto): LocalWorkspaceSkill {
  const base = toMarketSkill({
    ...entry,
    downloads: entry.downloads ?? 0,
    sourceId: entry.sourceId ?? 'local-workspace',
    verified: false,
  });
  const location =
    entry.workspaceRelativePath && entry.workspaceRelativePath !== '.'
      ? `路径：${entry.workspaceRelativePath}`
      : '路径：工作区根目录';
  return {
    ...base,
    description:
      base.description.trim().length > 0 ? `${base.description} · ${location}` : location,
    dirPath: entry.dirPath,
    manifestPath: entry.manifestPath,
    workspaceRelativePath: entry.workspaceRelativePath,
  };
}

export function matchesLocalSkill(
  skill: LocalWorkspaceSkill,
  query?: string,
  category?: string,
): boolean {
  if (category && skill.category !== category) {
    return false;
  }
  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [skill.id, skill.name, skill.description, skill.workspaceRelativePath, ...skill.tags]
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery);
}

export function useSkillsApi() {
  const { gatewayUrl, accessToken } = useAuthStore();
  const client = useMemo(() => createSkillsClient(gatewayUrl), [gatewayUrl]);
  const token = accessToken ?? '';

  const searchSkills = useCallback(
    async (
      q?: string,
      category?: string,
      page = 1,
      pageSize = MARKET_PAGE_SIZE,
    ): Promise<MarketSearchResult> => {
      const data = (await client.search(token, {
        ...(q ? { q } : {}),
        ...(category ? { category } : {}),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })) as { skills: SkillEntryDto[]; total?: number };
      const sourceMap = new Map<string, string>();
      for (const entry of data.skills) {
        if (entry.sourceId) sourceMap.set(entry.id, entry.sourceId);
      }
      return {
        skills: data.skills.map(toMarketSkill),
        sourceMap,
        total: data.total ?? data.skills.length,
      };
    },
    [client, token],
  );

  const installSkill = useCallback(
    async (skillId: string, sourceId?: string): Promise<void> => {
      await client.install(token, { skillId, ...(sourceId ? { sourceId } : {}) });
    },
    [client, token],
  );

  const discoverLocalSkills = useCallback(async (): Promise<LocalSkillEntryDto[]> => {
    const data = (await client.discoverLocal(token)) as { skills: LocalSkillEntryDto[] };
    return data.skills;
  }, [client, token]);

  const installLocalSkill = useCallback(
    async (dirPath: string): Promise<void> => {
      await client.installLocal(token, dirPath);
    },
    [client, token],
  );

  const fetchSources = useCallback(async (): Promise<RegistrySource[]> => {
    const data = (await client.listRegistrySources(token)) as { sources: RegistrySource[] };
    return data.sources;
  }, [client, token]);

  const syncSources = useCallback(
    async (sourceIds?: string[]): Promise<void> => {
      await client.syncRegistrySources(token, sourceIds);
    },
    [client, token],
  );

  const addSource = useCallback(
    async (url: string): Promise<void> => {
      await client.addRegistrySource(token, { name: url, url });
    },
    [client, token],
  );

  const removeSource = useCallback(
    async (id: string): Promise<void> => {
      await client.removeRegistrySource(token, id);
    },
    [client, token],
  );

  const toggleSource = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      await client.setRegistrySourceEnabled(token, id, enabled);
    },
    [client, token],
  );

  const fetchSkillDetail = useCallback(
    async (skillId: string): Promise<MarketSkillDetail> => {
      const data = (await client.getDetail(token, skillId)) as SkillEntryDto & {
        readme?: string;
        license?: string;
        permissions?: string[];
        downloads?: number;
        verified?: boolean;
      };
      return {
        id: data.id,
        name: data.displayName ?? data.name ?? data.id,
        version: data.version ?? '0.0.0',
        description: data.description ?? '',
        category: data.category ?? 'other',
        tags: data.tags ?? [],
        downloads: data.downloads ?? 0,
        verified: data.verified ?? false,
        author: data.author ?? '',
        license: data.license ?? '',
        readme: data.readme ?? '',
        permissions: data.permissions ?? [],
        changelog: data.changelog,
      };
    },
    [client, token],
  );

  return {
    searchSkills,
    installSkill,
    installLocalSkill,
    discoverLocalSkills,
    fetchSources,
    syncSources,
    addSource,
    removeSource,
    toggleSource,
    fetchSkillDetail,
  };
}
