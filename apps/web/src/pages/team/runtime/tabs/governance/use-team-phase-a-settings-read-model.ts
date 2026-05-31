import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConstitutionRecord,
  ConstitutionTemplate,
  ForceApplyState,
  InstructionStackPreview,
  PersonaResponse,
  SoulRoleLayer,
  TeamPhaseAClient,
  UserMemoryRecord,
} from '@openAwork/web-client';
import { useTeamEventsConnectionStore } from '../../../../../stores/team/team-events.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from '../../../hooks/recoverable-read-model.js';
import { useRecoverableRetryController } from '../../../hooks/use-recoverable-retry.js';

const TEAM_PHASE_A_SETTINGS_RETRY_BASE_MS = 2_000;
const TEAM_PHASE_A_SETTINGS_RETRY_MAX_MS = 30_000;

export function computeTeamPhaseASettingsRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_PHASE_A_SETTINGS_RETRY_BASE_MS,
    maxMs: TEAM_PHASE_A_SETTINGS_RETRY_MAX_MS,
  });
}

export function formatTeamPhaseASettingsLoadError(input: {
  baseMessage: string;
  hasRetainedData: boolean;
  nextRetryAtMs?: number | null;
  retainedDataLabel: string;
  retryable: boolean;
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.baseMessage,
    hasRetainedData: input.hasRetainedData,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: input.retainedDataLabel,
    retryable: input.retryable,
  });
}

interface ConstitutionReadModel {
  applyConstitution: (record: ConstitutionRecord) => void;
  constitution: ConstitutionRecord | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  templates: ConstitutionTemplate[];
}

interface UserMemoryReadModel {
  applyMemory: (record: UserMemoryRecord) => void;
  error: string | null;
  loading: boolean;
  memory: UserMemoryRecord | null;
  refresh: () => void;
}

interface PersonaReadModel {
  applyPersonaResponse: (response: PersonaResponse) => void;
  error: string | null;
  loading: boolean;
  personaResponse: PersonaResponse | null;
  refresh: () => void;
}

interface ForceApplyStateReadModel {
  applyState: (state: ForceApplyState) => void;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  state: ForceApplyState | null;
}

interface InstructionStackPreviewReadModel {
  busy: boolean;
  error: string | null;
  preview: InstructionStackPreview | null;
  previewInstructionStack: (input: {
    personaKey?: string;
    roleLayer?: SoulRoleLayer;
    sessionId?: string;
    teamWorkspaceId?: string;
  }) => void;
}

export function useRecoverableConstitutionRead(input: {
  client: TeamPhaseAClient;
  teamWorkspaceId: string | null;
  token: string;
}): ConstitutionReadModel {
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const [constitution, setConstitution] = useState<ConstitutionRecord | null>(null);
  const [templates, setTemplates] = useState<ConstitutionTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const constitutionRef = useRef<ConstitutionRecord | null>(null);
  const templatesRef = useRef<ConstitutionTemplate[]>([]);
  const currentWorkspaceRef = useRef<string | null>(null);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  useEffect(() => {
    constitutionRef.current = constitution;
  }, [constitution]);

  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  const refresh = useCallback(() => {
    resetRetry();
    setRefreshTick((current) => current + 1);
  }, [resetRetry]);

  useEffect(() => {
    let cancelled = false;
    clearRetry();

    if (!input.teamWorkspaceId) {
      currentWorkspaceRef.current = null;
      resetRetry();
      setConstitution(null);
      setTemplates([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    const isWorkspaceChanged = currentWorkspaceRef.current !== input.teamWorkspaceId;
    currentWorkspaceRef.current = input.teamWorkspaceId;
    if (isWorkspaceChanged && constitutionRef.current?.teamWorkspaceId !== input.teamWorkspaceId) {
      setConstitution(null);
    }

    const hasRetainedData =
      constitutionRef.current?.teamWorkspaceId === input.teamWorkspaceId ||
      templatesRef.current.length > 0;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamPhaseASettingsLoadError({
          baseMessage: '当前网络离线，团队宪法暂时不可用。',
          hasRetainedData,
          retainedDataLabel: '宪法数据',
          retryable: true,
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    setLoading(!hasRetainedData);
    setError(null);

    void Promise.all([
      input.client.getConstitutionResult(input.token, input.teamWorkspaceId),
      input.client.listConstitutionTemplatesResult(input.token),
    ]).then(([constitutionResult, templatesResult]) => {
      if (cancelled) {
        return;
      }

      if (constitutionResult.ok && constitutionResult.constitution) {
        setConstitution(constitutionResult.constitution);
      }
      if (templatesResult.ok) {
        setTemplates(templatesResult.templates);
      }

      const failedResult = !constitutionResult.ok
        ? constitutionResult
        : !templatesResult.ok
          ? templatesResult
          : null;

      if (failedResult) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamPhaseASettingsRetryDelay,
          onRetry: () => {
            setRefreshTick((current) => current + 1);
          },
          retryable: failedResult.retryable,
        });
        setLoading(false);
        setError(
          formatTeamPhaseASettingsLoadError({
            baseMessage: failedResult.errorMessage ?? '加载团队宪法失败。',
            hasRetainedData:
              (constitutionResult.ok && Boolean(constitutionResult.constitution)) ||
              templatesResult.ok ||
              hasRetainedData,
            nextRetryAtMs,
            retainedDataLabel: '宪法数据',
            retryable: failedResult.retryable,
          }),
        );
        return;
      }

      resetRetry();
      setLoading(false);
      setError(null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    clearRetry,
    input.client,
    input.teamWorkspaceId,
    input.token,
    refreshTick,
    resetRetry,
    scheduleRetry,
  ]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (typeof window === 'undefined' || !input.teamWorkspaceId) {
      return;
    }
    const handleOnline = () => {
      refresh();
    };
    const handleOffline = () => {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamPhaseASettingsLoadError({
          baseMessage: '当前网络离线，团队宪法暂时不可用。',
          hasRetainedData:
            constitutionRef.current?.teamWorkspaceId === input.teamWorkspaceId ||
            templatesRef.current.length > 0,
          retainedDataLabel: '宪法数据',
          retryable: true,
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [input.teamWorkspaceId, refresh, resetRetry]);

  useEffect(() => {
    if (!input.teamWorkspaceId || !teamEventsRecoveredAt) {
      return;
    }
    refresh();
  }, [input.teamWorkspaceId, refresh, teamEventsRecoveredAt]);

  return {
    applyConstitution: (record) => {
      setConstitution(record);
    },
    constitution,
    error,
    loading,
    refresh,
    templates,
  };
}

export function useRecoverableUserMemoryRead(input: {
  client: TeamPhaseAClient;
  token: string;
}): UserMemoryReadModel {
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const [memory, setMemory] = useState<UserMemoryRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const memoryRef = useRef<UserMemoryRecord | null>(null);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  useEffect(() => {
    memoryRef.current = memory;
  }, [memory]);

  const refresh = useCallback(() => {
    resetRetry();
    setRefreshTick((current) => current + 1);
  }, [resetRetry]);

  useEffect(() => {
    let cancelled = false;
    clearRetry();

    const hasRetainedData = memoryRef.current !== null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamPhaseASettingsLoadError({
          baseMessage: '当前网络离线，个人长期记忆暂时不可用。',
          hasRetainedData,
          retainedDataLabel: '个人记忆',
          retryable: true,
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    setLoading(!hasRetainedData);
    setError(null);

    void input.client.getUserMemoryResult(input.token).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok || !result.memory) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamPhaseASettingsRetryDelay,
          onRetry: () => {
            setRefreshTick((current) => current + 1);
          },
          retryable: result.retryable,
        });
        setLoading(false);
        setError(
          formatTeamPhaseASettingsLoadError({
            baseMessage: result.errorMessage ?? '加载个人长期记忆失败。',
            hasRetainedData,
            nextRetryAtMs,
            retainedDataLabel: '个人记忆',
            retryable: result.retryable,
          }),
        );
        return;
      }

      resetRetry();
      setMemory(result.memory);
      setLoading(false);
      setError(null);
    });

    return () => {
      cancelled = true;
    };
  }, [clearRetry, input.client, input.token, refreshTick, resetRetry, scheduleRetry]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      refresh();
    };
    const handleOffline = () => {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamPhaseASettingsLoadError({
          baseMessage: '当前网络离线，个人长期记忆暂时不可用。',
          hasRetainedData: memoryRef.current !== null,
          retainedDataLabel: '个人记忆',
          retryable: true,
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refresh, resetRetry]);

  useEffect(() => {
    if (!teamEventsRecoveredAt) {
      return;
    }
    refresh();
  }, [refresh, teamEventsRecoveredAt]);

  return {
    applyMemory: (record) => {
      setMemory(record);
    },
    error,
    loading,
    memory,
    refresh,
  };
}

export function useRecoverablePersonaRead(input: {
  client: TeamPhaseAClient;
  roleLayer: SoulRoleLayer;
  token: string;
}): PersonaReadModel {
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const [personaResponse, setPersonaResponse] = useState<PersonaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const personaRef = useRef<PersonaResponse | null>(null);
  const currentLayerRef = useRef<SoulRoleLayer | null>(null);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  useEffect(() => {
    personaRef.current = personaResponse;
  }, [personaResponse]);

  const refresh = useCallback(() => {
    resetRetry();
    setRefreshTick((current) => current + 1);
  }, [resetRetry]);

  useEffect(() => {
    let cancelled = false;
    clearRetry();

    const isLayerChanged = currentLayerRef.current !== input.roleLayer;
    currentLayerRef.current = input.roleLayer;
    if (isLayerChanged && personaRef.current?.roleLayer !== input.roleLayer) {
      setPersonaResponse(null);
    }

    const hasRetainedData = personaRef.current?.roleLayer === input.roleLayer;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamPhaseASettingsLoadError({
          baseMessage: '当前网络离线，角色 SOUL 暂时不可用。',
          hasRetainedData,
          retainedDataLabel: '角色 SOUL',
          retryable: true,
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    setLoading(!hasRetainedData);
    setError(null);

    void input.client.getPersonaResult(input.token, input.roleLayer).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok || !result.personaResponse) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamPhaseASettingsRetryDelay,
          onRetry: () => {
            setRefreshTick((current) => current + 1);
          },
          retryable: result.retryable,
        });
        setLoading(false);
        setError(
          formatTeamPhaseASettingsLoadError({
            baseMessage: result.errorMessage ?? '加载角色 SOUL 失败。',
            hasRetainedData,
            nextRetryAtMs,
            retainedDataLabel: '角色 SOUL',
            retryable: result.retryable,
          }),
        );
        return;
      }

      resetRetry();
      setPersonaResponse(result.personaResponse);
      setLoading(false);
      setError(null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    clearRetry,
    input.client,
    input.roleLayer,
    input.token,
    refreshTick,
    resetRetry,
    scheduleRetry,
  ]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      refresh();
    };
    const handleOffline = () => {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamPhaseASettingsLoadError({
          baseMessage: '当前网络离线，角色 SOUL 暂时不可用。',
          hasRetainedData: personaRef.current?.roleLayer === input.roleLayer,
          retainedDataLabel: '角色 SOUL',
          retryable: true,
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [input.roleLayer, refresh, resetRetry]);

  useEffect(() => {
    if (!teamEventsRecoveredAt) {
      return;
    }
    refresh();
  }, [refresh, teamEventsRecoveredAt]);

  return {
    applyPersonaResponse: (response) => {
      setPersonaResponse(response);
    },
    error,
    loading,
    personaResponse,
    refresh,
  };
}

export function useRecoverableForceApplyStateRead(input: {
  client: TeamPhaseAClient;
  token: string;
}): ForceApplyStateReadModel {
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const [state, setState] = useState<ForceApplyState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const stateRef = useRef<ForceApplyState | null>(null);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(() => {
    resetRetry();
    setRefreshTick((current) => current + 1);
  }, [resetRetry]);

  useEffect(() => {
    let cancelled = false;
    clearRetry();

    const hasRetainedData = stateRef.current !== null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamPhaseASettingsLoadError({
          baseMessage: '当前网络离线，ForceApply 状态暂时不可用。',
          hasRetainedData,
          retainedDataLabel: 'ForceApply 状态',
          retryable: true,
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    setLoading(!hasRetainedData);
    setError(null);

    void input.client.getForceApplyStateResult(input.token).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok || !result.state) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamPhaseASettingsRetryDelay,
          onRetry: () => {
            setRefreshTick((current) => current + 1);
          },
          retryable: result.retryable,
        });
        setLoading(false);
        setError(
          formatTeamPhaseASettingsLoadError({
            baseMessage: result.errorMessage ?? '加载 ForceApply 状态失败。',
            hasRetainedData,
            nextRetryAtMs,
            retainedDataLabel: 'ForceApply 状态',
            retryable: result.retryable,
          }),
        );
        return;
      }

      resetRetry();
      setState(result.state);
      setLoading(false);
      setError(null);
    });

    return () => {
      cancelled = true;
    };
  }, [clearRetry, input.client, input.token, refreshTick, resetRetry, scheduleRetry]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      refresh();
    };
    const handleOffline = () => {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamPhaseASettingsLoadError({
          baseMessage: '当前网络离线，ForceApply 状态暂时不可用。',
          hasRetainedData: stateRef.current !== null,
          retainedDataLabel: 'ForceApply 状态',
          retryable: true,
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refresh, resetRetry]);

  useEffect(() => {
    if (!teamEventsRecoveredAt) {
      return;
    }
    refresh();
  }, [refresh, teamEventsRecoveredAt]);

  return {
    applyState: (nextState) => {
      setState(nextState);
    },
    error,
    loading,
    refresh,
    state,
  };
}

export function useInstructionStackPreviewRead(input: {
  client: TeamPhaseAClient;
  token: string;
}): InstructionStackPreviewReadModel {
  const [preview, setPreview] = useState<InstructionStackPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<InstructionStackPreview | null>(null);
  const lastRequestRef = useRef<{
    personaKey?: string;
    roleLayer?: SoulRoleLayer;
    sessionId?: string;
    teamWorkspaceId?: string;
  } | null>(null);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const previewInstructionStack = useCallback(
    (request: {
      personaKey?: string;
      roleLayer?: SoulRoleLayer;
      sessionId?: string;
      teamWorkspaceId?: string;
    }) => {
      lastRequestRef.current = request;
      resetRetry();
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setBusy(false);
        setError(
          formatTeamPhaseASettingsLoadError({
            baseMessage: '当前网络离线，指令栈预览暂时不可用。',
            hasRetainedData: previewRef.current !== null,
            retainedDataLabel: '预览结果',
            retryable: true,
          }),
        );
        return;
      }
      setBusy(true);
      setError(null);

      void input.client.previewInstructionStackResult(input.token, request).then((result) => {
        if (!result.ok || !result.preview) {
          const nextRetryAtMs = scheduleRetry({
            computeDelay: computeTeamPhaseASettingsRetryDelay,
            onRetry: () => {
              if (lastRequestRef.current) {
                previewInstructionStack(lastRequestRef.current);
              }
            },
            retryable: result.retryable,
          });
          setBusy(false);
          setError(
            formatTeamPhaseASettingsLoadError({
              baseMessage: result.errorMessage ?? '生成指令栈预览失败。',
              hasRetainedData: previewRef.current !== null,
              nextRetryAtMs,
              retainedDataLabel: '预览结果',
              retryable: result.retryable,
            }),
          );
          return;
        }

        resetRetry();
        setPreview(result.preview);
        setBusy(false);
        setError(null);
      });
    },
    [input.client, input.token, resetRetry, scheduleRetry],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      if (lastRequestRef.current) {
        previewInstructionStack(lastRequestRef.current);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [previewInstructionStack]);

  return {
    busy,
    error,
    preview,
    previewInstructionStack,
  };
}
