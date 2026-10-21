import { useCallback, useEffect, useRef, useState } from 'react';
import { InstallProgressUI, SkillDetailPage, SkillMarketHome } from '@openAwork/shared-ui';
import type {
  InstallStep,
  MarketSkill,
  MarketSkillDetail,
  RegistrySource,
} from '@openAwork/shared-ui';
import { SkillsInstalledSection } from '../../components/skills/skills-installed-section.js';
import { SkillsPageHeader } from '../../components/skills/skills-page-header.js';
import { SkillsTabBar, type SkillsTab } from '../../components/skills/skills-tab-bar.js';
import { useInstalledSkills } from '../../hooks/skills/use-installed-skills.js';
import {
  MARKET_PAGE_SIZE,
  matchesLocalSkill,
  toLocalSkill,
  useSkillsApi,
  type LocalWorkspaceSkill,
} from './use-skills-api.js';

type InstallTarget =
  | { mode: 'market'; skillId: string; sourceId?: string }
  | { mode: 'local'; skillId: string; dirPath: string };

type MarketSkillEntry = MarketSkill & Partial<MarketSkillDetail>;

/**
 * 技能页动作的统一包装：`run` 全流程留在 try 内，catch 交给 `onError`
 * （不传＝异常继续向上抛，不得静默吞掉），finally 跑清理。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * try 内的值块（catch 里的 `err instanceof Error ? … : …` 同样触发），本页 4 处 try
 * 会让整页脱靶（实测）。语义逐字照搬。
 */
async function runSkillsPageActionOnce(ctx: {
  onError?: (error: unknown) => void;
  onFinally?: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    if (!ctx.onError) {
      throw error;
    }
    ctx.onError(error);
  } finally {
    ctx.onFinally?.();
  }
}

export default function SkillsPage() {
  const [activeTab, setActiveTab] = useState<SkillsTab>('market');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MarketSkillDetail | null>(null);
  const [selectedInstallTarget, setSelectedInstallTarget] = useState<InstallTarget | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const didInitMarketRef = useRef(false);
  const marketRequestSeqRef = useRef(0);
  // 「页码越界时夹回最后一页」需要 loadMarket 自引用，而把它写在 loadMarket 自己的
  // useCallback 体内会触发 React Compiler 的 "Cannot access variable before it is
  // declared"（会让整页脱靶）。按仓库既有惯例（use-page-readiness.ts 的 `onReadyRef`）
  // 改成「ref 持有最新实现 + effect 同步」，递归调用读的是最新一次渲染的实现。
  const loadMarketRef = useRef<
    ((next?: { query?: string; category?: string; page?: number }) => Promise<void>) | null
  >(null);

  const [marketSkills, setMarketSkills] = useState<MarketSkillEntry[]>([]);
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

  const [registrySources, setRegistrySources] = useState<RegistrySource[]>([]);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [installSteps, setInstallSteps] = useState<InstallStep[]>([]);

  const installed = useInstalledSkills();
  const {
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
  } = useSkillsApi();

  const loadMarket = useCallback(
    async (next?: { query?: string; category?: string; page?: number }) => {
      const resolvedQuery = next && 'query' in next ? next.query : marketQuery;
      const resolvedCategory = next && 'category' in next ? next.category : marketCategory;
      const requestedPage = next?.page ?? marketPage;
      const requestSeq = ++marketRequestSeqRef.current;

      setMarketLoading(true);
      setMarketError(null);
      // try/catch/finally 下沉到模块级 `runSkillsPageActionOnce`（见其注释）。
      await runSkillsPageActionOnce({
        onError: (err) => {
          if (requestSeq === marketRequestSeqRef.current) {
            setMarketError(err instanceof Error ? err.message : 'Failed to load skills');
          }
        },
        onFinally: () => {
          if (requestSeq === marketRequestSeqRef.current) {
            setMarketLoading(false);
          }
        },
        run: async () => {
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
            void loadMarketRef.current?.({
              query: resolvedQuery,
              category: resolvedCategory,
              page: totalPages,
            });
            return;
          }

          setMarketSkills(skills);
          setMarketSkillSources(sourceMap);
          setMarketQuery(resolvedQuery);
          setMarketCategory(resolvedCategory);
          setMarketPage(requestedPage);
          setMarketTotal(total);
        },
      });
    },
    [marketCategory, marketPage, marketQuery, searchSkills],
  );

  // 把最新实现同步进 loadMarketRef（刻意放在 effect 里，不在渲染期直接赋值）；
  // 读取点只有 loadMarket 内部的「页码越界夹回」，见 loadMarketRef 声明处说明。
  useEffect(() => {
    loadMarketRef.current = loadMarket;
  });

  const loadLocalCatalog = useCallback(async () => {
    setLocalLoading(true);
    setLocalError(null);
    // try/catch/finally 下沉到模块级 `runSkillsPageActionOnce`（见其注释）。
    await runSkillsPageActionOnce({
      onError: (err) => {
        setLocalCatalog([]);
        setLocalError(err instanceof Error ? err.message : 'Failed to discover local skills');
      },
      onFinally: () => {
        setLocalLoading(false);
      },
      run: async () => {
        const skills = await discoverLocalSkills();
        setLocalCatalog(skills.map(toLocalSkill));
      },
    });
  }, [discoverLocalSkills]);

  const loadSources = useCallback(async () => {
    const sources = await fetchSources();
    setRegistrySources(sources);
  }, [fetchSources]);

  const refreshMarket = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    // try/catch/finally 下沉到模块级 `runSkillsPageActionOnce`（见其注释）。
    await runSkillsPageActionOnce({
      onError: (err) => {
        setMarketError(err instanceof Error ? err.message : 'Failed to refresh skills');
      },
      onFinally: () => {
        setMarketLoading(false);
      },
      run: async () => {
        await syncSources();
        const sources = await fetchSources();
        setRegistrySources(sources);
        await loadMarket();
      },
    });
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
    if (activeTab === 'local') {
      void loadLocalCatalog();
    }
  }, [activeTab, loadLocalCatalog]);

  const installedSkillIds = new Set(installed.skills.map((skill) => skill.id));
  const localSkills = localCatalog
    .filter((skill) => matchesLocalSkill(skill, localQuery, localCategory))
    .map((skill) => ({
      ...skill,
      actionLabel: installedSkillIds.has(skill.id) ? '重新加载' : '安装',
    }));

  const combinedSkillIndex = [...marketSkills, ...localSkills];

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
    // try/catch/finally 下沉到模块级 `runSkillsPageActionOnce`（见其注释）。
    await runSkillsPageActionOnce({
      onError: (err) => {
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
      },
      onFinally: () => {
        setTimeout(() => {
          setInstallingSkillId(null);
          setInstallSteps([]);
        }, 1500);
      },
      run: async () => {
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
        void installed.reload();
        if (isLocalSkill) {
          void loadLocalCatalog();
        }
      },
    });
  }

  function handleUpdate(id: string) {
    const installedSkill = installed.skills.find((skill) => skill.id === id);
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
        await handleInstall({ mode: 'local', skillId: id, dirPath: matchingLocalSkill.dirPath });
      })();
      return;
    }

    // 系统安装的技能（~/.claude/skills 等自动发现）不能走市场安装路径：
    // 其 source_id 是扫描根目录而非注册源地址，改为触发系统目录重扫。
    if (installedSkill.source.startsWith('local-system:')) {
      void (async () => {
        await installed.resync();
        await installed.reload();
      })();
      return;
    }

    void handleInstall({ mode: 'market', skillId: id, sourceId: installedSkill.source });
  }

  function handleSelectSkill(
    id: string,
    fallbackBase: MarketSkillEntry | LocalWorkspaceSkill,
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

  const updateCount = installed.skills.filter(
    (skill) => skill.latestVersion && skill.latestVersion !== skill.version,
  ).length;

  if (selectedSkillId !== null) {
    return (
      <div className="page-root" style={{ overflowY: 'auto' }}>
        {detailLoading || !selectedDetail ? (
          <div style={{ padding: '2rem', color: 'var(--fg-muted)', fontSize: 14 }}>加载中...</div>
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
            isInstalled={installed.skills.some((s) => s.id === selectedSkillId)}
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
            alignItems: 'center',
            background: 'color-mix(in oklab, var(--bg-base) 72%, transparent)',
            display: 'flex',
            inset: 0,
            justifyContent: 'center',
            position: 'fixed',
            zIndex: 999,
          }}
        >
          <InstallProgressUI
            skillName={
              combinedSkillIndex.find((s) => s.id === installingSkillId)?.name ?? installingSkillId
            }
            steps={installSteps}
            onCancel={() => setInstallingSkillId(null)}
          />
        </div>
      )}

      <div className="page-content">
        <div
          style={{
            display: 'grid',
            gap: 16,
            margin: '0 auto',
            maxWidth: 1380,
            padding: '2px 4px 20px',
            width: '100%',
          }}
        >
          <SkillsPageHeader
            marketTotal={marketTotal}
            installedCount={installed.skills.length}
            sourceCount={registrySources.length}
            updateCount={updateCount}
            busy={marketLoading || localLoading || installed.busy}
            onRefresh={() => {
              if (activeTab === 'market') {
                void refreshMarket();
              } else if (activeTab === 'local') {
                void loadLocalCatalog();
                void installed.reload();
              } else {
                void installed.reload();
                void loadSources();
              }
            }}
          />

          <SkillsTabBar
            activeTab={activeTab}
            updateCount={updateCount}
            onTabChange={(tab) => setActiveTab(tab)}
          />

          {activeTab === 'market' && (
            <SkillMarketHome
              skills={marketSkills}
              categories={[]}
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
            <SkillMarketHome
              skills={localSkills}
              categories={[]}
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
              loading={!installed.loaded}
              skills={installed.skills}
              registrySources={registrySources}
              onUninstall={(id) => void installed.uninstall(id)}
              onUpdate={handleUpdate}
              onCheckUpdates={() => void installed.checkUpdates()}
              onToggle={(id, next) => void installed.toggle(id, next)}
              statusMessage={installed.statusMessage}
              error={installed.error}
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
