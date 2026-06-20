/**
 * 工作区知识图谱数据源：
 * - /team/artifacts：工作区产物链；
 * - /team/instruction-stack/preview：实际注入运行时的架构、宪法、项目记忆、个人记忆等。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTeamPhaseAClient,
  type SoulRoleLayer,
  type TeamWorkspaceKnowledgeRecord,
  type UpsertTeamWorkspaceKnowledgeInput,
  type UpsertTeamWorkspaceKnowledgeResult,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../stores/team/team-events.js';
import {
  parseInstructionStack,
  type InstructionStackSegment,
} from '../data/parse-instruction-stack.js';
import { isWholeWorkspaceKnowledgeSearchTerm } from '../data/workspace-knowledge-search.js';
import {
  workspaceKnowledgeKeyMatchesSemanticSearch,
  workspaceKnowledgeKeySearchLabel,
  workspaceKnowledgeRoleLayerSearchKind,
  workspaceKnowledgeRoleLayersMatchSearch,
  workspaceKnowledgeSemanticSearchKind,
  type WorkspaceKnowledgeSemanticSearchKind,
  type WorkspaceKnowledgeRoleLayerSearchKind,
} from '../data/workspace-knowledge-key-classification.js';
import {
  useTeamWorkspaceArtifacts,
  type WorkspaceArtifact,
} from './use-team-workspace-artifacts.js';

const WORKSPACE_KNOWLEDGE_GRAPH_QUERY_LIMIT = 1200;

export interface UseTeamWorkspaceKnowledgeOptions {
  roleLayer?: SoulRoleLayer;
  search?: string;
}

export interface UseTeamWorkspaceKnowledgeResult {
  artifacts: WorkspaceArtifact[];
  error: string | null;
  instructionSegments: InstructionStackSegment[];
  loading: boolean;
  persistedKnowledge: TeamWorkspaceKnowledgeRecord[];
  persistedKnowledgeTruncated: boolean;
  saveKnowledge: (
    input: UpsertTeamWorkspaceKnowledgeInput,
  ) => Promise<UpsertTeamWorkspaceKnowledgeResult>;
  storedKnowledge: TeamWorkspaceKnowledgeRecord[];
}

export function useTeamWorkspaceKnowledge(
  teamWorkspaceId: string | null | undefined,
  options: UseTeamWorkspaceKnowledgeOptions = {},
): UseTeamWorkspaceKnowledgeResult {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const recoveredAt = useTeamEventsConnectionStore((s) => s.lastRecoveredAt);
  const artifactState = useTeamWorkspaceArtifacts(teamWorkspaceId);
  const [instructionSegments, setInstructionSegments] = useState<InstructionStackSegment[]>([]);
  const [storedKnowledge, setStoredKnowledge] = useState<TeamWorkspaceKnowledgeRecord[]>([]);
  const [persistedKnowledge, setPersistedKnowledge] = useState<TeamWorkspaceKnowledgeRecord[]>([]);
  const [persistedKnowledgeTruncated, setPersistedKnowledgeTruncated] = useState(false);
  const [stackLoading, setStackLoading] = useState(false);
  const [stackError, setStackError] = useState<string | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const reqIdRef = useRef(0);
  const knowledgeReqIdRef = useRef(0);
  const loadedInstructionWorkspaceIdRef = useRef<string | null>(null);
  const loadedKnowledgeWorkspaceIdRef = useRef<string | null>(null);
  const knowledgeFallbackCacheRef = useRef<TeamWorkspaceKnowledgeRecord[]>([]);

  const client = useMemo(
    () => (gatewayUrl ? createTeamPhaseAClient(gatewayUrl) : null),
    [gatewayUrl],
  );

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    if (!token || !client || !teamWorkspaceId) {
      setInstructionSegments([]);
      setStackError(null);
      setStackLoading(false);
      return;
    }

    setStackLoading(true);
    setStackError(null);
    void client
      .previewInstructionStackResult(token, {
        roleLayer: options.roleLayer,
        teamWorkspaceId,
      })
      .then((result) => {
        if (reqIdRef.current !== reqId) return;
        if (!result.ok || !result.preview) {
          if (loadedInstructionWorkspaceIdRef.current !== teamWorkspaceId) {
            setInstructionSegments([]);
          }
          setStackError(result.errorMessage ?? '加载工作区知识上下文失败。');
          setStackLoading(false);
          return;
        }
        setInstructionSegments(parseInstructionStack(result.preview.stableBlock));
        loadedInstructionWorkspaceIdRef.current = teamWorkspaceId;
        setStackLoading(false);
      })
      .catch((error: unknown) => {
        if (reqIdRef.current !== reqId) return;
        if (loadedInstructionWorkspaceIdRef.current !== teamWorkspaceId) {
          setInstructionSegments([]);
        }
        setStackError(error instanceof Error ? error.message : '加载工作区知识上下文失败。');
        setStackLoading(false);
      });
  }, [client, options.roleLayer, recoveredAt, refreshVersion, teamWorkspaceId, token]);

  useEffect(() => {
    const reqId = ++knowledgeReqIdRef.current;
    if (!token || !client || !teamWorkspaceId) {
      setStoredKnowledge([]);
      setPersistedKnowledge([]);
      setPersistedKnowledgeTruncated(false);
      knowledgeFallbackCacheRef.current = [];
      setKnowledgeError(null);
      setKnowledgeLoading(false);
      return;
    }

    const search = options.search?.trim();
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    void client
      .listWorkspaceKnowledgeResult(token, teamWorkspaceId, {
        enabled: true,
        limit: WORKSPACE_KNOWLEDGE_GRAPH_QUERY_LIMIT,
        roleLayer: options.roleLayer,
        search: search && search.length > 0 ? search : undefined,
      })
      .then((result) => {
        if (knowledgeReqIdRef.current !== reqId) return;
        if (!result.ok) {
          if (loadedKnowledgeWorkspaceIdRef.current !== teamWorkspaceId) {
            setStoredKnowledge([]);
            setPersistedKnowledge([]);
            setPersistedKnowledgeTruncated(false);
            knowledgeFallbackCacheRef.current = [];
          } else {
            setStoredKnowledge((current) => {
              const fallbackRecords =
                knowledgeFallbackCacheRef.current.length > 0
                  ? knowledgeFallbackCacheRef.current
                  : current;
              return filterCachedKnowledgeRecords(fallbackRecords, {
                roleLayer: options.roleLayer,
                search,
              });
            });
          }
          setKnowledgeError(result.errorMessage ?? '加载工作区知识库失败。');
          setKnowledgeLoading(false);
          return;
        }
        knowledgeFallbackCacheRef.current = result.persistedKnowledge;
        setStoredKnowledge(
          filterCachedKnowledgeRecords(result.knowledge, {
            roleLayer: options.roleLayer,
            search,
          }),
        );
        setPersistedKnowledge(result.persistedKnowledge);
        setPersistedKnowledgeTruncated(result.persistedKnowledgeTruncated);
        loadedKnowledgeWorkspaceIdRef.current = teamWorkspaceId;
        setKnowledgeLoading(false);
      })
      .catch((error: unknown) => {
        if (knowledgeReqIdRef.current !== reqId) return;
        if (loadedKnowledgeWorkspaceIdRef.current !== teamWorkspaceId) {
          setStoredKnowledge([]);
          setPersistedKnowledge([]);
          setPersistedKnowledgeTruncated(false);
          knowledgeFallbackCacheRef.current = [];
        } else {
          setStoredKnowledge((current) => {
            const fallbackRecords =
              knowledgeFallbackCacheRef.current.length > 0
                ? knowledgeFallbackCacheRef.current
                : current;
            return filterCachedKnowledgeRecords(fallbackRecords, {
              roleLayer: options.roleLayer,
              search,
            });
          });
        }
        setKnowledgeError(error instanceof Error ? error.message : '加载工作区知识库失败。');
        setKnowledgeLoading(false);
      });
  }, [
    client,
    options.roleLayer,
    options.search,
    recoveredAt,
    refreshVersion,
    teamWorkspaceId,
    token,
  ]);

  const saveKnowledge = useCallback(
    async (input: UpsertTeamWorkspaceKnowledgeInput) => {
      if (!token || !client || !teamWorkspaceId) {
        throw new Error('当前工作区或登录状态不可用，无法入库知识。');
      }
      const result = await client.upsertWorkspaceKnowledge(token, teamWorkspaceId, input);
      const savedRecordVisible =
        filterCachedKnowledgeRecords([result.knowledge], {
          roleLayer: options.roleLayer,
          search: options.search?.trim(),
        }).length > 0;
      if (savedRecordVisible) {
        setStoredKnowledge((current) => upsertKnowledgeRecord(current, result.knowledge));
      } else {
        setStoredKnowledge((current) => current.filter((item) => item.id !== result.knowledge.id));
      }
      knowledgeFallbackCacheRef.current = upsertKnowledgeRecord(
        knowledgeFallbackCacheRef.current,
        result.knowledge,
      );
      setPersistedKnowledge((current) => upsertKnowledgeRecord(current, result.knowledge));
      setRefreshVersion((current) => current + 1);
      return result;
    },
    [client, options.roleLayer, options.search, teamWorkspaceId, token],
  );

  return {
    artifacts: artifactState.artifacts,
    error: artifactState.error ?? stackError ?? knowledgeError,
    instructionSegments,
    loading: artifactState.loading || stackLoading || knowledgeLoading,
    persistedKnowledge,
    persistedKnowledgeTruncated,
    saveKnowledge,
    storedKnowledge,
  };
}

function isKnowledgeReadableByRoleLayer(
  knowledge: TeamWorkspaceKnowledgeRecord,
  roleLayer: SoulRoleLayer | undefined,
): boolean {
  if (!roleLayer) {
    return true;
  }
  return knowledge.roleLayers === null || knowledge.roleLayers.includes(roleLayer);
}

function upsertKnowledgeRecord(
  records: TeamWorkspaceKnowledgeRecord[],
  record: TeamWorkspaceKnowledgeRecord,
): TeamWorkspaceKnowledgeRecord[] {
  const next = records.filter((item) => item.id !== record.id);
  return [record, ...next];
}

function filterCachedKnowledgeRecords(
  records: TeamWorkspaceKnowledgeRecord[],
  options: { roleLayer?: SoulRoleLayer; search?: string },
): TeamWorkspaceKnowledgeRecord[] {
  const normalizedSearch = options.search?.trim().toLocaleLowerCase();
  const semanticSearchKind = normalizedSearch
    ? workspaceKnowledgeSemanticSearchKind(normalizedSearch)
    : null;
  const roleLayerSearchKind = normalizedSearch
    ? workspaceKnowledgeRoleLayerSearchKind(normalizedSearch)
    : null;
  return records.filter((record) => {
    if (!isKnowledgeReadableByRoleLayer(record, options.roleLayer)) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    if (isWholeWorkspaceKnowledgeSearchTerm(normalizedSearch)) {
      return true;
    }
    if (roleLayerSearchKind) {
      return workspaceKnowledgeRecordMatchesRoleLayerSearch(record, roleLayerSearchKind);
    }
    if (semanticSearchKind) {
      return workspaceKnowledgeRecordMatchesSemanticSearch(record, semanticSearchKind);
    }
    return workspaceKnowledgeRecordSearchHaystack(record).includes(normalizedSearch);
  });
}

function workspaceKnowledgeRecordMatchesRoleLayerSearch(
  record: TeamWorkspaceKnowledgeRecord,
  kind: WorkspaceKnowledgeRoleLayerSearchKind,
): boolean {
  return workspaceKnowledgeRoleLayersMatchSearch(record.roleLayers, kind);
}

function workspaceKnowledgeRecordMatchesSemanticSearch(
  record: TeamWorkspaceKnowledgeRecord,
  kind: WorkspaceKnowledgeSemanticSearchKind,
): boolean {
  switch (kind) {
    case 'architecture':
    case 'artifact':
      return workspaceKnowledgeKeyMatchesSemanticSearch(record.key, kind);
    case 'fact':
      return record.type === 'fact';
    case 'instruction':
      return record.type === 'instruction';
    case 'project-memory':
      if (
        workspaceKnowledgeKeyMatchesSemanticSearch(record.key, 'artifact') ||
        workspaceKnowledgeKeyMatchesSemanticSearch(record.key, 'architecture')
      ) {
        return false;
      }
      return record.type === 'project_context';
    case 'memory':
      if (
        workspaceKnowledgeKeyMatchesSemanticSearch(record.key, 'artifact') ||
        workspaceKnowledgeKeyMatchesSemanticSearch(record.key, 'architecture')
      ) {
        return false;
      }
      return (
        record.type === 'project_context' ||
        record.type === 'learned_pattern' ||
        record.type === 'preference' ||
        record.type === 'fact'
      );
  }
}

function workspaceKnowledgeRecordSearchHaystack(record: TeamWorkspaceKnowledgeRecord): string {
  return [
    record.id,
    record.key,
    recordKeySearchLabel(record.key),
    record.value,
    record.source,
    recordSourceSearchLabel(record.source),
    record.type,
    recordTypeSearchLabel(record.type),
    '已入库 persisted saved',
    roleLayerSearchLabel(record.roleLayers),
  ]
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join('\n')
    .toLocaleLowerCase();
}

function recordTypeSearchLabel(type: TeamWorkspaceKnowledgeRecord['type']): string {
  switch (type) {
    case 'instruction':
      return '规则 指令 团队宪法 constitution instruction';
    case 'project_context':
      return '项目上下文 项目记忆 知识 project context';
    case 'learned_pattern':
      return '经验 沉淀 记忆 复盘 learned pattern';
    case 'preference':
      return '个人记忆 用户记忆 偏好 记忆 preference';
    case 'fact':
      return '事实 记忆 fact';
  }
}

function recordKeySearchLabel(key: string): string {
  return workspaceKnowledgeKeySearchLabel(key);
}

function recordSourceSearchLabel(source: TeamWorkspaceKnowledgeRecord['source']): string {
  switch (source) {
    case 'manual':
      return '手动 manual';
    case 'auto_extracted':
      return '自动 抽取 auto extracted';
    case 'api':
      return 'api';
  }
}

const ROLE_LAYER_SEARCH_LABELS: Record<SoulRoleLayer, string> = {
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  reviewer: '评审',
};

function roleLayerSearchLabel(roleLayers: TeamWorkspaceKnowledgeRecord['roleLayers']): string {
  if (roleLayers === null || roleLayers.length === 0) {
    return '全部层级 全部可读 all layers';
  }
  return roleLayers
    .map((roleLayer) => `${roleLayer} ${ROLE_LAYER_SEARCH_LABELS[roleLayer]}`)
    .join('\n');
}
