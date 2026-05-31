import type { FixedTeamMemberSlot } from '@openAwork/shared';
import {
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

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

/** 模板候选模型池中的一项（provider + model 引用）。 */
export interface WorkflowTeamTemplateModelRef {
  providerId: string;
  modelId: string;
}

/** 智能分配策略：质量优先 / 成本优先 / 均衡 / 单一模型铺满。 */
export type WorkflowTeamTemplateModelStrategy = 'quality' | 'cost' | 'balanced' | 'single';

export interface WorkflowTeamTemplateMetadata {
  defaultBindings?: Partial<
    Record<WorkflowTemplateRequiredRole, string | WorkflowTeamTemplateRoleBinding>
  >;
  defaultProvider?: string | null;
  /**
   * 模板预定义的可见成员花名册（按层分组，承载 specialty / personaKey / toolsets）。
   * 创建 session 时如未额外传 memberSlots，则采用该花名册作为默认。
   * 与 L1.2A「人物 = visible member slot」一致，不引入新的 roleLayer。
   */
  memberSlots?: FixedTeamMemberSlot[];
  /**
   * 模板的候选模型池：用户从真实 provider 配置里勾选「参与本模板分配」的模型。
   * 「智能分配模型」只在该池内挑选；为空时回退到默认行为。
   */
  modelPool?: WorkflowTeamTemplateModelRef[];
  /** 上次使用的智能分配策略（用于回显 UI 选择）。 */
  modelAssignStrategy?: WorkflowTeamTemplateModelStrategy;
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

/** 「一键智能分配模型」候选模型（带能力 / 价格元数据）。 */
export interface AssignTeamModelCandidate {
  providerId: string;
  providerName?: string;
  modelId: string;
  label?: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface AssignTeamModelsInput {
  strategy: WorkflowTeamTemplateModelStrategy;
  pool: AssignTeamModelCandidate[];
  layers: Array<{ layer: string; memberLabels: string[] }>;
}

export interface AssignTeamModelsResult {
  assignments: Array<{
    layer: string;
    providerId: string;
    modelId: string;
    /** AI 推荐理由（规则引擎兜底时为本地生成的简述）。 */
    reason?: string;
  }>;
  /** 'llm' = 上游推荐（至少部分有效）；'fallback' = 规则引擎兜底。 */
  source: 'llm' | 'fallback';
  /** 完全回退时的原因码：'llm-error'（上游报错）/ 'llm-empty'（解析无有效项）。 */
  fallbackReasonCode?: 'llm-error' | 'llm-empty';
  /** 上游错误信息（fallbackReasonCode='llm-error' 时）。 */
  fallbackMessage?: string;
  /** 上游原始返回片段（fallbackReasonCode='llm-empty' 时，便于排查）。 */
  llmRawSnippet?: string;
}

export interface WorkflowsClient {
  listTemplates(token: string): Promise<WorkflowTemplateRecord[]>;
  listTemplatesResult(token: string): Promise<WorkflowTemplateListResult>;
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
  assignTeamModels(token: string, input: AssignTeamModelsInput): Promise<AssignTeamModelsResult>;
}

export interface WorkflowTemplateListResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
  templates: WorkflowTemplateRecord[];
}

function buildAuthHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function isRetryableWorkflowTemplateStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildWorkflowTemplateListErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取工作流模板。';
  }
  return `加载工作流模板失败（HTTP ${status}）。`;
}

function buildWorkflowTemplateActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标工作流模板不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericWorkflowTemplateNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeWorkflowTemplateActionError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage((error.data ?? undefined) as JsonErrorData | undefined);
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericWorkflowTemplateNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performWorkflowTemplateRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildWorkflowTemplateActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeWorkflowTemplateActionError(input.actionLabel, error);
  }
}

export function createWorkflowsClient(baseUrl: string): WorkflowsClient {
  const listTemplatesResult = async (token: string): Promise<WorkflowTemplateListResult> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/workflows/templates`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        let data: JsonErrorData | undefined;
        try {
          data = (await response.json()) as JsonErrorData;
        } catch {
          data = undefined;
        }
        return {
          ok: false,
          retryable: isRetryableWorkflowTemplateStatus(response.status),
          errorMessage: buildWorkflowTemplateListErrorMessage(response.status, data),
          status: response.status,
          templates: [],
        };
      }
      return {
        ok: true,
        retryable: false,
        templates: (await response.json()) as WorkflowTemplateRecord[],
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeWorkflowTemplateActionError('加载工作流模板', error).message,
        templates: [],
      };
    }
  };

  return {
    async listTemplates(token: string): Promise<WorkflowTemplateRecord[]> {
      const result = await listTemplatesResult(token);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '加载工作流模板失败');
      }
      return result.templates;
    },

    listTemplatesResult,

    async createTemplate(
      token: string,
      input: CreateWorkflowTemplateInput,
    ): Promise<WorkflowTemplateRecord> {
      return performWorkflowTemplateRequest<WorkflowTemplateRecord>({
        actionLabel: '创建工作流模板',
        request: () =>
          fetchWithTimeout(`${baseUrl}/workflows/templates`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
    },

    async updateTemplate(
      token: string,
      templateId: string,
      input: UpdateWorkflowTemplateInput,
    ): Promise<WorkflowTemplateRecord> {
      return performWorkflowTemplateRequest<WorkflowTemplateRecord>({
        actionLabel: '更新工作流模板',
        request: () =>
          fetchWithTimeout(`${baseUrl}/workflows/templates/${encodeURIComponent(templateId)}`, {
            method: 'PATCH',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
    },

    async removeTemplate(token: string, templateId: string): Promise<void> {
      await performWorkflowTemplateRequest({
        actionLabel: '删除工作流模板',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/workflows/templates/${encodeURIComponent(templateId)}`, {
            method: 'DELETE',
            headers: buildAuthHeaders(token),
          }),
      });
    },

    async optimizePrompt(
      token: string,
      input: OptimizePromptInput,
    ): Promise<PromptOptimizerResult> {
      return performWorkflowTemplateRequest<PromptOptimizerResult>({
        actionLabel: '优化提示词',
        request: () =>
          fetchWithTimeout(`${baseUrl}/workflows/optimize-prompt`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
    },

    async translate(token: string, tasks: TranslationTaskInput[]): Promise<TranslationResult[]> {
      const data = await performWorkflowTemplateRequest<{ results?: TranslationResult[] }>({
        actionLabel: '翻译工作流任务',
        request: () =>
          fetchWithTimeout(`${baseUrl}/workflows/translate`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ tasks }),
          }),
      });
      return data.results ?? [];
    },

    async assignTeamModels(
      token: string,
      input: AssignTeamModelsInput,
    ): Promise<AssignTeamModelsResult> {
      return performWorkflowTemplateRequest<AssignTeamModelsResult>({
        actionLabel: '智能分配模型',
        request: () =>
          fetchWithTimeout(`${baseUrl}/workflows/assign-team-models`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
    },
  };
}
