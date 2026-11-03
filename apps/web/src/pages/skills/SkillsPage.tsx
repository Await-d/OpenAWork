import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InstallProgressUI } from '@openAwork/shared-ui';
import type { MarketSkill, MarketSkillDetail, RegistrySource } from '@openAwork/shared-ui';
import { SkillsCatalogList } from '../../components/skills/skills-catalog-list.js';
import { SkillsDetailPanel } from '../../components/skills/skills-detail-panel.js';
import { SkillsMetaPanel } from '../../components/skills/skills-meta-panel.js';
import { SkillsPageHeader } from '../../components/skills/skills-page-header.js';
import {
  mergeSkillDisplayDetail,
  toInstalledRow,
  toLocalRow,
  toMarketRow,
} from '../../components/skills/skills-page-model.js';
import type { SkillRow } from '../../components/skills/skills-page-model.js';
import type { SkillsTab } from '../../components/skills/skills-tab-bar.js';
import { useInstalledSkills } from '../../hooks/skills/use-installed-skills.js';
import {
  MARKET_PAGE_SIZE,
  matchesLocalSkill,
  toLocalSkill,
  useSkillsApi,
  type LocalWorkspaceSkill,
} from './use-skills-api.js';
import '../../styles/console-surfaces.css';
import '../../components/skills/skills-page.css';

/** 市场条目：列表接口只回摘要，详情字段按需补齐。 */
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

/**
 * 安装进度步骤：按「市场安装 / 本地加载」两套文案推进三段式进度。
 *
 *   start    → [进行中, 待执行, 待执行]（解析阶段）
 *   download → [已完成, 进行中, 待执行]
 *   done     → [已完成, 已完成, 已完成]
 */
function buildInstallSteps(kind: 'market' | 'local', phase: 'start' | 'download' | 'done') {
  const labels =
    kind === 'local' ? ['解析清单', '加载本地技能', '校验'] : ['解析依赖', '下载中', '校验'];
  const activeIndex = phase === 'start' ? 0 : phase === 'download' ? 1 : labels.length;
  return labels.map((label, index) => ({
    label,
    status:
      index < activeIndex
        ? ('done' as const)
        : index === activeIndex
          ? ('running' as const)
          : ('pending' as const),
  }));
}

function buildInstallErrorSteps(kind: 'market' | 'local', message: string) {
  const labels =
    kind === 'local' ? ['解析清单', '加载本地技能', '校验'] : ['解析依赖', '下载中', '校验'];
  return labels.map((label, index) => ({
    label,
    status:
      index === 0 ? ('done' as const) : index === 1 ? ('error' as const) : ('pending' as const),
    ...(index === 1 ? { message } : {}),
  }));
}

export default function SkillsPage() {
  const [activeTab, setActiveTab] = useState<SkillsTab>('market');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MarketSkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // 安装来源选择按**条目**记忆（而不是全局一个值），否则选完 A 技能再选 B 技能时，
  // A 的选择会被当成 B 的安装来源——B 未必存在于该注册源里。
  const [installSourceChoice, setInstallSourceChoice] = useState<{
    rowId: string;
    sourceId: string;
  } | null>(null);
  const didInitMarketRef = useRef(false);
  const marketRequestSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);
  // 「页码越界时夹回最后一页」需要 loadMarket 自引用，而把它写在 loadMarket 自己的
  // useCallback 体内会触发 React Compiler 的 "Cannot access variable before it is
  // declared"（会让整页脱靶）。按仓库既有惯例（use-page-readiness.ts 的 `onReadyRef`）
  // 改成「ref 持有最新实现 + effect 同步」，递归调用读的是最新一次渲染的实现。
  const loadMarketRef = useRef<
    ((next?: { query?: string; page?: number }) => Promise<void>) | null
  >(null);

  const [marketSkills, setMarketSkills] = useState<MarketSkillEntry[]>([]);
  const [marketSkillSources, setMarketSkillSources] = useState<Map<string, string>>(new Map());
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketQuery, setMarketQuery] = useState<string | undefined>(undefined);
  const [marketPage, setMarketPage] = useState(1);
  const [marketTotal, setMarketTotal] = useState(0);

  const [localCatalog, setLocalCatalog] = useState<LocalWorkspaceSkill[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localQuery, setLocalQuery] = useState<string | undefined>(undefined);

  const [registrySources, setRegistrySources] = useState<RegistrySource[]>([]);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [installSteps, setInstallSteps] = useState<
    ReturnType<typeof buildInstallSteps> | ReturnType<typeof buildInstallErrorSteps>
  >([]);

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
    async (next?: { query?: string; page?: number }) => {
      const resolvedQuery = next && 'query' in next ? next.query : marketQuery;
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
            undefined,
            requestedPage,
            MARKET_PAGE_SIZE,
          );

          if (requestSeq !== marketRequestSeqRef.current) {
            return;
          }

          const totalPages = Math.max(1, Math.ceil(total / MARKET_PAGE_SIZE));
          if (total > 0 && requestedPage > totalPages) {
            void loadMarketRef.current?.({ query: resolvedQuery, page: totalPages });
            return;
          }

          setMarketSkills(skills);
          setMarketSkillSources(sourceMap);
          setMarketQuery(resolvedQuery);
          setMarketPage(requestedPage);
          setMarketTotal(total);
        },
      });
    },
    [marketPage, marketQuery, searchSkills],
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

  const installedIndex = useMemo(
    () => new Map(installed.skills.map((skill) => [skill.id, skill])),
    [installed.skills],
  );

  const marketRows = useMemo(
    () =>
      marketSkills.map((skill) => {
        const installedSkill = installedIndex.get(skill.id);
        return toMarketRow(skill, {
          source: marketSkillSources.get(skill.id) ?? '',
          installedVersion: installedSkill?.version ?? null,
          enabled: installedSkill?.enabled ?? null,
          preinstalled: installedSkill?.preinstalled ?? false,
        });
      }),
    [installedIndex, marketSkillSources, marketSkills],
  );

  const localRows = useMemo(
    () =>
      localCatalog
        .filter((skill) => matchesLocalSkill(skill, localQuery, undefined))
        .map((skill) => {
          const installedSkill = installedIndex.get(skill.id);
          return toLocalRow(skill, {
            source: 'local-workspace',
            installedVersion: installedSkill?.version ?? null,
            enabled: installedSkill?.enabled ?? null,
            preinstalled: installedSkill?.preinstalled ?? false,
          });
        }),
    [installedIndex, localCatalog, localQuery],
  );

  const installedRows = useMemo(() => installed.skills.map(toInstalledRow), [installed.skills]);

  // 安装进度浮层要显示技能名，而安装可能从任一视图发起，所以三处数据源都建索引。
  const skillNameIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const skill of marketSkills) {
      index.set(skill.id, skill.name);
    }
    for (const skill of localCatalog) {
      index.set(skill.id, skill.name);
    }
    for (const skill of installed.skills) {
      index.set(skill.id, skill.name);
    }
    return index;
  }, [installed.skills, localCatalog, marketSkills]);

  const rows: SkillRow[] =
    activeTab === 'market' ? marketRows : activeTab === 'local' ? localRows : installedRows;

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  /** 当前条目的安装来源：用户显式选择优先，否则用列表带回的来源。 */
  const installSourceId = selectedRow
    ? installSourceChoice?.rowId === selectedRow.id
      ? installSourceChoice.sourceId
      : selectedRow.source
    : '';

  // 展示用详情：以「条目自身」的版本/名称/描述/分类为准，市场详情只补充 README、权限
  // 等附加信息（同 id 的本地技能与市场条目是两件产物，不能拿市场版本覆盖本地版本）。
  const displayDetail = useMemo(
    () => (selectedRow ? mergeSkillDisplayDetail(selectedRow, selectedDetail) : null),
    [selectedDetail, selectedRow],
  );

  // 选中项跟随列表：当前选中的条目不在可见列表里时，回落到首条（含切换 tab 与筛选）。
  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }
    if (!selectedId || !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0]!.id);
    }
  }, [rows, selectedId]);

  // 详情按选中项拉取；本地 / 已安装条目拿不到市场详情时，用列表行字段兜底（不再报错）。
  useEffect(() => {
    if (!selectedRow) {
      setSelectedDetail(null);
      setDetailLoading(false);
      return;
    }

    const seq = ++detailRequestSeqRef.current;
    setSelectedDetail(null);
    setDetailLoading(true);
    void fetchSkillDetail(selectedRow.id)
      .then((detail) => {
        if (seq === detailRequestSeqRef.current) {
          setSelectedDetail(detail);
        }
      })
      .catch(() => {
        if (seq !== detailRequestSeqRef.current) {
          return;
        }
        setSelectedDetail({
          id: selectedRow.id,
          name: selectedRow.name,
          version: selectedRow.version,
          description: selectedRow.description,
          category: selectedRow.category,
          tags: selectedRow.tags,
          downloads: selectedRow.downloads,
          verified: selectedRow.verified,
          installable: selectedRow.installable,
          author: '',
          license: '',
          readme: '',
          permissions: [],
        });
      })
      .finally(() => {
        if (seq === detailRequestSeqRef.current) {
          setDetailLoading(false);
        }
      });
  }, [fetchSkillDetail, selectedRow]);

  async function handleInstall(row: SkillRow) {
    const dirPath = row.dirPath;
    const kind = dirPath ? 'local' : 'market';
    // 来源优先用「当前条目的选择」，为空时交给服务端按默认来源解析。
    const sourceId = installSourceId || undefined;
    setInstallingSkillId(row.id);
    setInstallSteps(buildInstallSteps(kind, 'start'));
    // try/catch/finally 下沉到模块级 `runSkillsPageActionOnce`（见其注释）。
    await runSkillsPageActionOnce({
      onError: (err) => {
        const msg = err instanceof Error ? err.message : 'Install failed';
        setInstallSteps(buildInstallErrorSteps(kind, msg));
      },
      onFinally: () => {
        setTimeout(() => {
          setInstallingSkillId(null);
          setInstallSteps([]);
        }, 1500);
      },
      run: async () => {
        setInstallSteps(buildInstallSteps(kind, 'download'));
        if (dirPath) {
          await installLocalSkill(dirPath);
        } else {
          await installSkill(row.id, sourceId);
        }
        setInstallSteps(buildInstallSteps(kind, 'done'));
        void installed.reload();
        if (dirPath) {
          void loadLocalCatalog();
        }
      },
    });
  }

  function handleUpdate(row: SkillRow) {
    if (row.systemSourced) {
      void (async () => {
        await installed.resync();
        await installed.reload();
      })();
      return;
    }

    if (row.source === 'local-workspace') {
      void (async () => {
        const latestLocalSkills = await discoverLocalSkills();
        const matchingLocalSkill = latestLocalSkills.find((skill) => skill.id === row.id);
        if (!matchingLocalSkill) {
          return;
        }
        const localSkill = toLocalSkill(matchingLocalSkill);
        await handleInstall(
          toLocalRow(localSkill, {
            source: 'local-workspace',
            installedVersion: row.installedVersion,
            enabled: row.enabled,
            preinstalled: row.preinstalled,
          }),
        );
      })();
      return;
    }

    void handleInstall({ ...row, dirPath: null });
  }

  const updateCount = installed.skills.filter(
    (skill) => skill.latestVersion && skill.latestVersion !== skill.version,
  ).length;

  const listLoading =
    activeTab === 'market'
      ? marketLoading
      : activeTab === 'local'
        ? localLoading
        : !installed.loaded;
  // 市场 / 本地的加载失败就地显示在左列；已安装视图的失败属于「操作结果」，
  // 统一走页面顶部提示条，避免同一条错误在两处各渲染一次。
  const listError =
    activeTab === 'market' ? marketError : activeTab === 'local' ? localError : null;
  const searchValue =
    activeTab === 'market' ? (marketQuery ?? '') : activeTab === 'local' ? (localQuery ?? '') : '';

  return (
    <div className="skills-console">
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

      {activeTab === 'installed' && installed.statusMessage ? (
        <div className="console-status">{installed.statusMessage}</div>
      ) : null}
      {activeTab === 'installed' && installed.error ? (
        <div className="console-alert" role="alert">
          {installed.error}
        </div>
      ) : null}

      <div className="skills-workbench">
        <SkillsCatalogList
          activeTab={activeTab}
          updateCount={updateCount}
          onTabChange={(tab) => setActiveTab(tab)}
          query={searchValue}
          onQueryChange={(value) => {
            if (activeTab === 'market') {
              setMarketQuery(value);
            } else if (activeTab === 'local') {
              setLocalQuery(value);
            }
          }}
          onSearch={() => {
            if (activeTab === 'market') {
              void loadMarket({ query: marketQuery, page: 1 });
            }
          }}
          rows={rows}
          loading={listLoading}
          error={listError}
          selectedId={selectedId}
          onSelect={setSelectedId}
          currentPage={marketPage}
          total={marketTotal}
          pageSize={MARKET_PAGE_SIZE}
          onPageChange={(page) => void loadMarket({ page })}
          onCheckUpdates={() => void installed.checkUpdates()}
          onRescan={() => {
            void loadLocalCatalog();
            void installed.reload();
          }}
          busy={installed.busy || marketLoading || localLoading}
        />

        <SkillsDetailPanel
          tab={activeTab}
          row={selectedRow}
          detail={displayDetail}
          detailLoading={detailLoading}
          busy={installed.busy || installingSkillId !== null}
          onInstall={() => {
            if (selectedRow) {
              void handleInstall(selectedRow);
            }
          }}
          onToggle={(nextEnabled) => {
            if (selectedRow) {
              void installed.toggle(selectedRow.id, nextEnabled);
            }
          }}
          onUpdate={() => {
            if (selectedRow) {
              handleUpdate(selectedRow);
            }
          }}
          onUninstall={() => {
            if (selectedRow) {
              void installed.uninstall(selectedRow.id);
            }
          }}
        />

        <SkillsMetaPanel
          tab={activeTab}
          row={selectedRow}
          detail={displayDetail}
          registrySources={registrySources}
          installSourceId={installSourceId}
          onInstallSourceChange={(sourceId) => {
            if (selectedRow) {
              setInstallSourceChoice({ rowId: selectedRow.id, sourceId });
            }
          }}
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
      </div>

      {installingSkillId !== null ? (
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
            skillName={skillNameIndex.get(installingSkillId) ?? installingSkillId}
            steps={installSteps}
            onCancel={() => setInstallingSkillId(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
