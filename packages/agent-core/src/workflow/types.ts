export type WorkflowNodeType = 'start' | 'end' | 'prompt' | 'tool' | 'condition' | 'subagent';

export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file';
  required: boolean;
  default?: unknown;
  description?: string;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: WorkflowVariable[];
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
}

export interface WorkflowExecution {
  id: string;
  templateId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  variables: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface WorkflowTemplateManager {
  create(
    template: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): WorkflowTemplate;
  get(id: string): WorkflowTemplate | undefined;
  list(): WorkflowTemplate[];
  update(
    id: string,
    patch: Partial<Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>>,
  ): WorkflowTemplate | undefined;
  delete(id: string): boolean;
  save(template: WorkflowTemplate): WorkflowTemplate;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class WorkflowTemplateManagerImpl implements WorkflowTemplateManager {
  private templates = new Map<string, WorkflowTemplate>();

  create(
    template: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): WorkflowTemplate {
    const now = Date.now();
    const created: WorkflowTemplate = {
      ...template,
      id: template.id ?? generateId(),
      createdAt: now,
      updatedAt: now,
    };
    this.templates.set(created.id, created);
    return created;
  }

  get(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  list(): WorkflowTemplate[] {
    return Array.from(this.templates.values());
  }

  update(
    id: string,
    patch: Partial<Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>>,
  ): WorkflowTemplate | undefined {
    const existing = this.templates.get(id);
    if (!existing) {
      return undefined;
    }
    const updated: WorkflowTemplate = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.templates.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.templates.delete(id);
  }

  save(template: WorkflowTemplate): WorkflowTemplate {
    this.templates.set(template.id, template);
    return template;
  }
}
