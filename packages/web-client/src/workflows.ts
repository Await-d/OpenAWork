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

export interface WorkflowTeamTemplateMetadata {
  defaultBindings?: Partial<Record<WorkflowTemplateRequiredRole, string>>;
  defaultProvider?: string | null;
  optionalAgentIds?: string[];
  recommendedDefault?: boolean;
  requiredRoles?: WorkflowTemplateRequiredRole[];
  templateFocus?: string;
  templatePriority?: number;
  templateScale?: WorkflowTemplateScale;
  recommendedFor?: string;
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

export interface WorkflowsClient {
  listTemplates(token: string): Promise<WorkflowTemplateRecord[]>;
  createTemplate(
    token: string,
    input: CreateWorkflowTemplateInput,
  ): Promise<WorkflowTemplateRecord>;
  removeTemplate(token: string, templateId: string): Promise<void>;
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
  };
}
