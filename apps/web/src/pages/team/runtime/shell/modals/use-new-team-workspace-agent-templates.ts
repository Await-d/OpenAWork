import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createResourcesClient,
  type ResourceTextCatalogEntry,
  type ResourcesClient,
} from '@openAwork/web-client';
import { listWorkspaceAgentTemplates } from './new-team-workspace-agent-templates.js';

export interface WorkspaceAgentTemplatesState {
  readonly error: string | null;
  readonly loading: boolean;
  readonly selectedTemplates: readonly ResourceTextCatalogEntry[];
  readonly selectedTemplateIds: readonly string[];
  readonly templates: readonly ResourceTextCatalogEntry[];
  readonly toggleTemplate: (templateId: string) => void;
}

export function useNewTeamWorkspaceAgentTemplates(input: {
  readonly accessToken: string | null;
  readonly gatewayUrl: string;
}): WorkspaceAgentTemplatesState {
  const resourcesClient = useMemo(
    () => createResourcesClient(input.gatewayUrl),
    [input.gatewayUrl],
  );
  return useWorkspaceAgentTemplatesState({
    accessToken: input.accessToken,
    resourcesClient,
  });
}

function useWorkspaceAgentTemplatesState(input: {
  readonly accessToken: string | null;
  readonly resourcesClient: ResourcesClient;
}): WorkspaceAgentTemplatesState {
  const [templates, setTemplates] = useState<readonly ResourceTextCatalogEntry[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!input.accessToken) {
      setTemplates([]);
      setSelectedTemplateIds([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void input.resourcesClient
      .list(input.accessToken)
      .then((resources) => {
        if (cancelled) {
          return;
        }
        const nextTemplates = listWorkspaceAgentTemplates(resources);
        setTemplates(nextTemplates);
        setSelectedTemplateIds((current) =>
          current.filter((id) => nextTemplates.some((template) => template.id === id)),
        );
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        setTemplates([]);
        setSelectedTemplateIds([]);
        setError(reason instanceof Error ? reason.message : '工作区模板资源加载失败');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [input.accessToken, input.resourcesClient]);

  const selectedTemplates = useMemo(
    () => templates.filter((template) => selectedTemplateIds.includes(template.id)),
    [selectedTemplateIds, templates],
  );

  const toggleTemplate = useCallback((templateId: string) => {
    setSelectedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId],
    );
  }, []);

  return {
    error,
    loading,
    selectedTemplates,
    selectedTemplateIds,
    templates,
    toggleTemplate,
  };
}
