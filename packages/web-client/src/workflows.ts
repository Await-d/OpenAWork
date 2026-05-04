export interface WorkflowNodeRecord {
  id: string;
  label: string;
  type: 'start' | 'end' | 'prompt' | 'tool' | 'condition' | 'subagent';
  x?: number;
  y?: number;
}

export interface WorkflowEdgeRecord {
  id: string;
  source: string;
  target: string;
}

export type WorkflowTemplateRequiredRole =
  | 'leader'
  | 'planner'
  | 'researcher'
  | 'executor'
  | 'reviewer';
export type WorkflowTemplateScale = 'full' | 'large' | 'medium' | 'small';

export interface WorkflowTeamTemplateRoleBinding {
  agentId: string;
  modelId?: string;
  providerId?: string;
  variant?: string;
}

export interface WorkflowTeamTemplateMetadata {
  defaultBindings?: Partial<
    Record<WorkflowTemplateRequiredRole, string | WorkflowTeamTemplateRoleBinding>
  >;
  defaultProvider?: string | null;
  optionalAgentIds?: string[];
  recommendedDefault?: boolean | null;
  requiredRoles?: WorkflowTemplateRequiredRole[];
  templateFocus?: string | null;
  templatePriority?: number | null;
  templateScale?: WorkflowTemplateScale | null;
  recommendedFor?: string | null;
}

export interface WorkflowTemplateMetadata {
  origin?: string;
  seedKey?: string;
  teamTemplate?: WorkflowTeamTemplateMetadata;
  templateKind?: string;
}

export interface WorkflowTemplateRecord {
  id: string;
  name: string;
  description: string | null;
  category: string;
  metadata?: WorkflowTemplateMetadata;
  nodes: WorkflowNodeRecord[];
  edges: WorkflowEdgeRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateWorkflowTemplateInput {
  name: string;
  description?: string;
  category?: string;
  metadata?: WorkflowTemplateMetadata;
  nodes: WorkflowNodeRecord[];
  edges: WorkflowEdgeRecord[];
}

export interface UpdateWorkflowTemplateInput {
  name?: string;
  description?: string | null;
  metadata?: WorkflowTemplateMetadata;
  nodes?: WorkflowNodeRecord[];
  edges?: WorkflowEdgeRecord[];
}

export interface PromptCandidate {
  id: string;
  text: string;
  improvements: string[];
  score?: number;
}

export interface PromptOptimizerResult {
  requestId: string;
  originalPrompt: string;
  candidates: PromptCandidate[];
  recommended: string;
  rationale: string;
  completedAt: number;
}

export interface OptimizePromptInput {
  originalPrompt: string;
  context?: string;
  targetAudience?: string;
  candidateCount?: number;
}

export interface TranslationTaskInput {
  id: string;
  content: string;
  fileName: string;
  sourceLanguage?: string;
  targetLanguage: string;
}

export interface TranslationResult {
  taskId: string;
  translatedContent: string;
  glossaryMatches?: number | null;
  status: string;
  completedAt: number;
}

export interface WorkflowsClient {
  listTemplates(token: string): Promise<WorkflowTemplateRecord[]>;
  createTemplate(
    token: string,
    input: CreateWorkflowTemplateInput,
  ): Promise<WorkflowTemplateRecord>;
  updateTemplate(
    token: string,
    templateId: string,
    input: UpdateWorkflowTemplateInput,
  ): Promise<WorkflowTemplateRecord>;
  removeTemplate(token: string, templateId: string): Promise<void>;
  optimizePrompt(token: string, input: OptimizePromptInput): Promise<PromptOptimizerResult>;
  translate(token: string, tasks: TranslationTaskInput[]): Promise<TranslationResult[]>;
}

function buildAuthHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export function createWorkflowsClient(baseUrl: string): WorkflowsClient {
  return {
    async listTemplates(token: string): Promise<WorkflowTemplateRecord[]> {
      const response = await fetch(`${baseUrl}/workflows/templates`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to load workflow templates: ${response.status}`);
      }
      return (await response.json()) as WorkflowTemplateRecord[];
    },

    async createTemplate(
      token: string,
      input: CreateWorkflowTemplateInput,
    ): Promise<WorkflowTemplateRecord> {
      const response = await fetch(`${baseUrl}/workflows/templates`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create workflow template: ${response.status}`);
      }
      return (await response.json()) as WorkflowTemplateRecord;
    },

    async updateTemplate(
      token: string,
      templateId: string,
      input: UpdateWorkflowTemplateInput,
    ): Promise<WorkflowTemplateRecord> {
      const response = await fetch(
        `${baseUrl}/workflows/templates/${encodeURIComponent(templateId)}`,
        {
          method: 'PATCH',
          headers: {
            ...buildAuthHeaders(token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to update workflow template: ${response.status}`);
      }
      return (await response.json()) as WorkflowTemplateRecord;
    },

    async removeTemplate(token: string, templateId: string): Promise<void> {
      const response = await fetch(
        `${baseUrl}/workflows/templates/${encodeURIComponent(templateId)}`,
        {
          method: 'DELETE',
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to delete workflow template: ${response.status}`);
      }
    },

    async optimizePrompt(
      token: string,
      input: OptimizePromptInput,
    ): Promise<PromptOptimizerResult> {
      const response = await fetch(`${baseUrl}/workflows/optimize-prompt`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to optimize prompt: ${response.status}`);
      }
      return (await response.json()) as PromptOptimizerResult;
    },

    async translate(token: string, tasks: TranslationTaskInput[]): Promise<TranslationResult[]> {
      const response = await fetch(`${baseUrl}/workflows/translate`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tasks }),
      });
      if (!response.ok) {
        throw new Error(`Failed to translate workflow tasks: ${response.status}`);
      }
      const data = (await response.json()) as { results?: TranslationResult[] };
      return data.results ?? [];
    },
  };
}
