import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { SkillDetailPage, InstallProgressUI } from '@openAwork/shared-ui';
import type {
  MarketSkill,
  MarketSkillDetail,
  MarketInstalledSkill,
  RegistrySource,
  InstallStep,
} from '@openAwork/shared-ui';
import {
  SkillsHero,
  SkillsInstalledSection,
  SkillsMarketSection,
  SkillsToolbar,
  sharedUiThemeVars,
} from '../components/skills/SkillsPageSections.js';

type ActiveTab = 'market' | 'local' | 'installed';

const MARKET_PAGE_SIZE = 24;

const DEFAULT_PREINSTALLED_SKILL_IDS = new Set([
  'github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator',
  'github:Await-d/agentdocs-orchestrator/schema-architect',
]);

interface SkillEntryDto {
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

interface MarketSearchResult {
  skills: MarketSkill[];
  sourceMap: Map<string, string>;
  total: number;
}

interface LocalSkillEntryDto extends SkillEntryDto {
  dirPath: string;
  manifestPath: string;
  workspaceRelativePath: string;
  installed?: boolean;
}

type InstallTarget =
  | { mode: 'market'; skillId: string; sourceId?: string }
  | { mode: 'local'; skillId: string; dirPath: string };

type LocalWorkspaceSkill = (MarketSkill & Partial<MarketSkillDetail>) & {
  dirPath: string;
  manifestPath: string;
  workspaceRelativePath: string;
};

function toMarketSkill(entry: SkillEntryDto): MarketSkill & Partial<MarketSkillDetail> {
  const installable = !(
    entry.sourceId === 'builtin' || (entry.sourceId ? entry.sourceId.startsWith('github:') : false)
  );
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

function toLocalSkill(entry: LocalSkillEntryDto): LocalWorkspaceSkill {
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

function matchesLocalSkill(skill: LocalWorkspaceSkill, query?: string, category?: string): boolean {
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

function useSkillsApi() {
  const { gatewayUrl, accessToken } = useAuthStore();

  const getHeaders = useCallback(
    (): HeadersInit => ({
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    }),
    [accessToken],
  );

  const searchSkills = useCallback(
    async (
      q?: string,
      category?: string,
      page = 1,
      pageSize = MARKET_PAGE_SIZE,
    ): Promise<MarketSearchResult> => {
      const url = new URL(`${gatewayUrl}/skills/search`);
      if (q) url.searchParams.set('q', q);
      if (category) url.searchParams.set('category', category);
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String((page - 1) * pageSize));
      const res = await fetch(url.toString(), { headers: getHeaders() });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = (await res.json()) as { skills: SkillEntryDto[]; total?: number };
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
    [gatewayUrl, getHeaders],
  );

  const fetchInstalled = useCallback(async (): Promise<MarketInstalledSkill[]> => {
    const res = await fetch(`${gatewayUrl}/skills/installed`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to load installed: ${res.status}`);
    const data = (await res.json()) as {
      skills: Array<{
        skillId: string;
        manifest: { name: string; version: string };
        sourceId: string;
        enabled: boolean;
      }>;
    };
    return data.skills.map((s) => ({
      id: s.skillId,
      name: s.manifest.name,
      version: s.manifest.version,
      latestVersion: s.manifest.version,
      source: s.sourceId,
      enabled: s.enabled,
      preinstalled: DEFAULT_PREINSTALLED_SKILL_IDS.has(s.skillId),
    }));
  }, [gatewayUrl, getHeaders]);

  const installSkill = useCallback(
    async (skillId: string, sourceId?: string): Promise<void> => {
      const res = await fetch(`${gatewayUrl}/skills/install`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ skillId, sourceId }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `Install failed: ${res.status}`);
      }
    },
    [gatewayUrl, getHeaders],
  );

  const uninstallSkill = useCallback(
    async (skillId: string): Promise<void> => {
      const res = await fetch(`${gatewayUrl}/skills/installed/${encodeURIComponent(skillId)}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error(`Uninstall failed: ${res.status}`);
    },
    [gatewayUrl, getHeaders],
  );

  const discoverLocalSkills = useCallback(async (): Promise<LocalSkillEntryDto[]> => {
    const res = await fetch(`${gatewayUrl}/skills/local/discover`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to discover local skills: ${res.status}`);
    const data = (await res.json()) as { skills: LocalSkillEntryDto[] };
    return data.skills;
  }, [gatewayUrl, getHeaders]);

  const installLocalSkill = useCallback(
    async (dirPath: string): Promise<void> => {
      const res = await fetch(`${gatewayUrl}/skills/local/install`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ dirPath }),
      });
      if (!res.ok) {
        const err = (await res
          .json()
          .catch(() => ({ error: `Install failed: ${res.status}` }))) as {
          error?: string;
        };
        throw new Error(err.error ?? `Install failed: ${res.status}`);
      }
    },
    [gatewayUrl, getHeaders],
  );

  const fetchSources = useCallback(async (): Promise<RegistrySource[]> => {
    const res = await fetch(`${gatewayUrl}/skills/registry-sources`, { headers: getHeaders() });
    if (!res.ok) return [];
    const data = (await res.json()) as { sources: RegistrySource[] };
    return data.sources;
  }, [gatewayUrl, getHeaders]);

  const syncSources = useCallback(
    async (sourceIds?: string[]): Promise<void> => {
      const res = await fetch(`${gatewayUrl}/skills/registry-sources/sync`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(sourceIds && sourceIds.length > 0 ? { sourceIds } : {}),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: `Sync failed: ${res.status}` }))) as {
          error?: string;
        };
        throw new Error(err.error ?? `Sync failed: ${res.status}`);
      }
    },
    [gatewayUrl, getHeaders],
  );

  const addSource = useCallback(
    async (url: string): Promise<void> => {
      await fetch(`${gatewayUrl}/skills/registry-sources`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name: url, url }),
      });
    },
    [gatewayUrl, getHeaders],
  );

  const removeSource = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`${gatewayUrl}/skills/registry-sources/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
    },
    [gatewayUrl, getHeaders],
  );

  const toggleSource = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      const res = await fetch(`${gatewayUrl}/skills/registry-sources/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: `Toggle failed: ${res.status}` }))) as {
          error?: string;
        };
        throw new Error(err.error ?? `Toggle failed: ${res.status}`);
      }
    },
    [gatewayUrl, getHeaders],
  );

  const fetchSkillDetail = useCallback(
    async (skillId: string): Promise<MarketSkillDetail> => {
      const res = await fetch(`${gatewayUrl}/skills/${encodeURIComponent(skillId)}`, {
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error(`Skill detail failed: ${res.status}`);
      const data = (await res.json()) as SkillEntryDto & {
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
    [gatewayUrl, getHeaders],
  );

  return {
    searchSkills,
    fetchInstalled,
    installSkill,
    uninstallSkill,
    fetchSources,
    syncSources,
    addSource,
    removeSource,
    toggleSource,
    fetchSkillDetail,
    discoverLocalSkills,
    installLocalSkill,
  };
}

export default function SkillsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('market');
  const [tabChanging, setTabChanging] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MarketSkillDetail | null>(null);
  const [selectedInstallTarget, setSelectedInstallTarget] = useState<InstallTarget | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const didInitMarketRef = useRef(false);
  const marketRequestSeqRef = useRef(0);

  const [marketSkills, setMarketSkills] = useState<Array<MarketSkill & Partial<MarketSkillDetail>>>(
    [],
  );
  const [marketSkillSources, setMarketSkillSources] = useState<Map<string, string>>(new Map());
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketQuery, setMarketQuery] = useState<string | undefined>(undefined);
  const [marketCategory, setMarketCategory] = useState<string | undefined>(undefined);
  const [marketPage, setMarketPage] = useState(1);
  const [marketTotal, setMarketTotal] = useState(0);

  const [localCatalog, setLocalCatalog] = useState<LocalWorkspaceSkill[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localQuery, setLocalQuery] = useState<string | undefined>(undefined);
  const [localCategory, setLocalCategory] = useState<string | undefined>(undefined);

  const [installedSkills, setInstalledSkills] = useState<MarketInstalledSkill[]>([]);
  const [installedLoading, setInstalledLoading] = useState(false);

  const [registrySources, setRegistrySources] = useState<RegistrySource[]>([]);

  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [installSteps, setInstallSteps] = useState<InstallStep[]>([]);

  const {
    searchSkills,
    fetchInstalled,
    installSkill,
    uninstallSkill,
    fetchSources,
    syncSources,
    addSource,
    removeSource,
    toggleSource,
    fetchSkillDetail,
    discoverLocalSkills,
    installLocalSkill,
  } = useSkillsApi();

  const loadMarket = useCallback(
    async (next?: { query?: string; category?: string; page?: number }) => {
      const resolvedQuery = next && 'query' in next ? next.query : marketQuery;
      const resolvedCategory = next && 'category' in next ? next.category : marketCategory;
      const requestedPage = next?.page ?? marketPage;
      const requestSeq = ++marketRequestSeqRef.current;

      setMarketLoading(true);
      setMarketError(null);
      try {
        const { skills, sourceMap, total } = await searchSkills(
          resolvedQuery,
          resolvedCategory,
          requestedPage,
          MARKET_PAGE_SIZE,
        );

        if (requestSeq !== marketRequestSeqRef.current) {
          return;
        }

        const totalPages = Math.max(1, Math.ceil(total / MARKET_PAGE_SIZE));
        if (total > 0 && requestedPage > totalPages) {
          void loadMarket({ query: resolvedQuery, category: resolvedCategory, page: totalPages });
          return;
        }

        setMarketSkills(skills);
        setMarketSkillSources(sourceMap);
        setMarketQuery(resolvedQuery);
        setMarketCategory(resolvedCategory);
        setMarketPage(requestedPage);
        setMarketTotal(total);
      } catch (err) {
        if (requestSeq === marketRequestSeqRef.current) {
          setMarketError(err instanceof Error ? err.message : 'Failed to load skills');
        }
      } finally {
        if (requestSeq === marketRequestSeqRef.current) {
          setMarketLoading(false);
        }
      }
    },
    [marketCategory, marketPage, marketQuery, searchSkills],
  );

  const loadInstalled = useCallback(async () => {
    setInstalledLoading(true);
    try {
      const skills = await fetchInstalled();
      setInstalledSkills(skills);
    } catch (_err) {
      setInstalledSkills([]);
    } finally {
      setInstalledLoading(false);
    }
  }, [fetchInstalled]);

  const loadLocalCatalog = useCallback(async () => {
    setLocalLoading(true);
    setLocalError(null);
    try {
      const skills = await discoverLocalSkills();
      setLocalCatalog(skills.map(toLocalSkill));
    } catch (err) {
      setLocalCatalog([]);
      setLocalError(err instanceof Error ? err.message : 'Failed to discover local skills');
    } finally {
      setLocalLoading(false);
    }
  }, [discoverLocalSkills]);

  const loadSources = useCallback(async () => {
    const sources = await fetchSources();
    setRegistrySources(sources);
  }, [fetchSources]);

  const refreshMarket = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      await syncSources();
      const sources = await fetchSources();
      setRegistrySources(sources);
      await loadMarket();
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : 'Failed to refresh skills');
    } finally {
      setMarketLoading(false);
    }
  }, [fetchSources, loadMarket, syncSources]);

  useEffect(() => {
    if (didInitMarketRef.current) {
      return;
    }
    didInitMarketRef.current = true;
    void loadMarket();
    void loadSources();
  }, [loadMarket, loadSources]);

  useEffect(() => {
    if (activeTab === 'installed' || activeTab === 'local') {
      void loadInstalled();
    }
    if (activeTab === 'local') {
      void loadLocalCatalog();
    }
  }, [activeTab, loadInstalled, loadLocalCatalog]);

  const installedSkillIds = useMemo(
    () => new Set(installedSkills.map((skill) => skill.id)),
    [installedSkills],
  );

  const localSkills = useMemo(
    () =>
      localCatalog
        .filter((skill) => matchesLocalSkill(skill, localQuery, localCategory))
        .map((skill) => ({
          ...skill,
          actionLabel: installedSkillIds.has(skill.id) ? '重新加载' : '安装',
        })),
    [installedSkillIds, localCatalog, localCategory, localQuery],
  );

  const combinedSkillIndex = useMemo(
    () => [...marketSkills, ...localSkills],
    [localSkills, marketSkills],
  );

  async function handleInstall(target: InstallTarget) {
    const isLocalSkill = target.mode === 'local';
    setInstallingSkillId(target.skillId);
    setInstallSteps(
      isLocalSkill
        ? [
            { label: '解析清单', status: 'running' },
            { label: '加载本地技能', status: 'pending' },
            { label: '校验', status: 'pending' },
          ]
        : [
            { label: '解析依赖', status: 'running' },
            { label: '下载中', status: 'pending' },
            { label: '校验', status: 'pending' },
          ],
    );
    try {
      setInstallSteps(
        isLocalSkill
          ? [
              { label: '解析清单', status: 'done' },
              { label: '加载本地技能', status: 'running' },
              { label: '校验', status: 'pending' },
            ]
          : [
              { label: '解析依赖', status: 'done' },
              { label: '下载中', status: 'running' },
              { label: '校验', status: 'pending' },
            ],
      );
      if (target.mode === 'local') {
        await installLocalSkill(target.dirPath);
      } else {
        await installSkill(target.skillId, target.sourceId);
      }
      setInstallSteps(
        isLocalSkill
          ? [
              { label: '解析清单', status: 'done' },
              { label: '加载本地技能', status: 'done' },
              { label: '校验', status: 'done' },
            ]
          : [
              { label: '解析依赖', status: 'done' },
              { label: '下载中', status: 'done' },
              { label: '校验', status: 'done' },
            ],
      );
      void loadInstalled();
      if (isLocalSkill) {
        void loadLocalCatalog();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Install failed';
      setInstallSteps(
        isLocalSkill
          ? [
              { label: '解析清单', status: 'done' },
              { label: '加载本地技能', status: 'error', message: msg },
              { label: '校验', status: 'pending' },
            ]
          : [
              { label: '解析依赖', status: 'done' },
              { label: '下载中', status: 'error', message: msg },
              { label: '校验', status: 'pending' },
            ],
      );
    } finally {
      setTimeout(() => {
        setInstallingSkillId(null);
        setInstallSteps([]);
      }, 1500);
    }
  }

  async function handleUninstall(id: string) {
    await uninstallSkill(id);
    void loadInstalled();
  }

  function handleUpdate(id: string) {
    const installedSkill = installedSkills.find((skill) => skill.id === id);
    if (!installedSkill) {
      return;
    }

    if (installedSkill.source === 'local-workspace') {
      void (async () => {
        const latestLocalSkills = await discoverLocalSkills();
        const matchingLocalSkill = latestLocalSkills.find((skill) => skill.id === id);
        if (!matchingLocalSkill) {
          return;
        }
        await handleInstall({
          mode: 'local',
          skillId: id,
          dirPath: matchingLocalSkill.dirPath,
        });
      })();
      return;
    }

    void handleInstall({ mode: 'market', skillId: id, sourceId: installedSkill.source });
  }

  function handleCheckUpdates() {
    void loadInstalled();
  }

  function handleSelectSkill(
    id: string,
    fallbackBase: (MarketSkill & Partial<MarketSkillDetail>) | LocalWorkspaceSkill,
    installTarget: InstallTarget,
  ) {
    setSelectedSkillId(id);
    setSelectedDetail(null);
    setSelectedInstallTarget(installTarget);
    setDetailLoading(true);
    fetchSkillDetail(id)
      .then((detail) => {
        setSelectedDetail(detail);
      })
      .catch(() => {
        setSelectedDetail({
          ...fallbackBase,
          author: fallbackBase.author ?? '',
          license: fallbackBase.license ?? '',
          readme: fallbackBase.readme ?? '',
          permissions: fallbackBase.permissions ?? [],
          changelog: fallbackBase.changelog,
        });
      })
      .finally(() => {
        setDetailLoading(false);
      });
  }

  const updateCount = installedSkills.filter(
    (skill) => skill.latestVersion && skill.latestVersion !== skill.version,
  ).length;

  if (selectedSkillId !== null) {
    return (
      <div className="page-root" style={{ overflowY: 'auto' }}>
        {detailLoading || !selectedDetail ? (
          <div style={{ padding: '2rem', color: 'var(--color-muted, #94a3b8)', fontSize: 14 }}>
            加载中...
          </div>
        ) : (
          <SkillDetailPage
            skill={selectedDetail}
            onInstall={() => {
              if (selectedInstallTarget) {
                void handleInstall(selectedInstallTarget);
              }
            }}
            onBack={() => {
              setSelectedSkillId(null);
              setSelectedDetail(null);
              setSelectedInstallTarget(null);
            }}
            isInstalled={installedSkills.some((s) => s.id === selectedSkillId)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="page-root">
      {installingSkillId !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'oklch(0 0 0 / 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
          }}
        >
          <div style={sharedUiThemeVars}>
            <InstallProgressUI
              skillName={
                combinedSkillIndex.find((s) => s.id === installingSkillId)?.name ??
                installingSkillId
              }
              steps={installSteps}
              onCancel={() => setInstallingSkillId(null)}
            />
          </div>
        </div>
      )}
      <div
        className="page-content"
        style={{
          opacity: tabChanging ? 0 : 1,
          transition: 'opacity 100ms ease',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 1380,
            margin: '0 auto',
            display: 'grid',
            gap: 16,
            padding: '2px 4px 20px',
          }}
        >
          <SkillsHero
            marketTotal={marketTotal}
            installedCount={installedSkills.length}
            sourceCount={registrySources.length}
            updateCount={updateCount}
          />

          <SkillsToolbar
            activeTab={activeTab}
            busy={marketLoading || localLoading || installedLoading}
            onRefresh={() => {
              if (activeTab === 'market') void refreshMarket();
              else if (activeTab === 'local') {
                void loadLocalCatalog();
                void loadInstalled();
              } else {
                void loadInstalled();
                void loadSources();
              }
            }}
            onTabChange={(tab) => {
              setTabChanging(true);
              setTimeout(() => {
                setActiveTab(tab);
                setTabChanging(false);
              }, 100);
            }}
          />

          {activeTab === 'market' && (
            <SkillsMarketSection
              skills={marketSkills}
              loading={marketLoading}
              error={marketError}
              currentPage={marketPage}
              pageSize={MARKET_PAGE_SIZE}
              total={marketTotal}
              onSearch={(q: string, cat?: string) =>
                void loadMarket({ query: q, category: cat, page: 1 })
              }
              onPageChange={(page: number) => void loadMarket({ page })}
              onInstall={(id) => {
                const base = marketSkills.find((skill) => skill.id === id);
                if (!base) {
                  return;
                }
                void handleInstall({
                  mode: 'market',
                  skillId: id,
                  sourceId: marketSkillSources.get(id),
                });
              }}
              onSelect={(id) => {
                const base = marketSkills.find((skill) => skill.id === id);
                if (!base) {
                  return;
                }
                handleSelectSkill(id, base, {
                  mode: 'market',
                  skillId: id,
                  sourceId: marketSkillSources.get(id),
                });
              }}
            />
          )}

          {activeTab === 'local' && (
            <SkillsMarketSection
              skills={localSkills}
              title="本地工作区技能"
              subtitle="扫描当前工作区中的 skill.yaml，并支持直接安装或重新加载。"
              loading={localLoading}
              error={localError}
              currentPage={1}
              pageSize={Math.max(localSkills.length, 1)}
              total={localSkills.length}
              onSearch={(q: string, cat?: string) => {
                setLocalQuery(q);
                setLocalCategory(cat);
              }}
              onPageChange={() => undefined}
              onInstall={(id) => {
                const base = localSkills.find((skill) => skill.id === id);
                if (!base) {
                  return;
                }
                void handleInstall({ mode: 'local', skillId: id, dirPath: base.dirPath });
              }}
              onSelect={(id) => {
                const base = localSkills.find((skill) => skill.id === id);
                if (!base) {
                  return;
                }
                handleSelectSkill(id, base, {
                  mode: 'local',
                  skillId: id,
                  dirPath: base.dirPath,
                });
              }}
            />
          )}

          {activeTab === 'installed' && (
            <SkillsInstalledSection
              loading={installedLoading}
              installedSkills={installedSkills}
              registrySources={registrySources}
              onUninstall={(id) => void handleUninstall(id)}
              onUpdate={handleUpdate}
              onCheckUpdates={handleCheckUpdates}
              onAddSource={(url) => {
                void (async () => {
                  await addSource(url);
                  await loadSources();
                  void loadMarket({ page: 1 });
                })();
              }}
              onRemoveSource={(id) => {
                void (async () => {
                  await removeSource(id);
                  await loadSources();
                  void loadMarket({ page: 1 });
                })();
              }}
              onToggleSource={(id, enabled) => {
                void (async () => {
                  await toggleSource(id, enabled);
                  await loadSources();
                  void loadMarket({ page: 1 });
                })();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
