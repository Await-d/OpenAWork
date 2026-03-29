import { createHmac, timingSafeEqual } from 'crypto';

export type GitHubEventType =
  | 'pull_request.opened'
  | 'pull_request.synchronize'
  | 'push'
  | 'issues.opened'
  | 'workflow_run.completed';

export interface GitHubTriggerConfig {
  appId: string;
  privateKeyPem: string;
  webhookSecretForHmacVerification: string;
  repoFullNameOwnerSlashRepo: string;
  events: GitHubEventType[];
  branchFilterUndefinedMeansAll?: string[];
  pathFilterUndefinedMeansAll?: string[];
  agentPromptTemplate: string;
  autoApproveWithoutUserConfirmation: boolean;
}

export interface GitHubWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

export interface AgentRoutingContext {
  eventType: GitHubEventType;
  repoFullName: string;
  payload: GitHubEventPayload;
  prompt: string;
  autoApprove: boolean;
}

export interface GitHubRouteResult {
  sessionId?: string;
}

export interface GitHubWebhookResult {
  handled: boolean;
  eventType?: GitHubEventType;
  repoFullName?: string;
  sessionId?: string;
}

export interface GitHubEventPayload {
  action?: string;
  ref?: string;
  repository?: { full_name: string };
  pull_request?: {
    number: number;
    title: string;
    head: { sha: string; ref: string };
    base: { ref: string };
  };
  issue?: { number: number; title: string; body?: string };
  commits?: Array<{
    id: string;
    message: string;
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  workflow_run?: {
    id: number;
    name: string;
    conclusion: string | null;
    head_sha: string;
  };
}

export type AgentRouteHandler = (ctx: AgentRoutingContext) => Promise<GitHubRouteResult | void>;

export interface GitHubTrigger {
  register(appConfig: GitHubTriggerConfig): void;
  handleWebhook(req: GitHubWebhookRequest): Promise<GitHubWebhookResult>;
  listTriggers(): Array<{ repo: string; events: string[] }>;
}

function extractHeaderString(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const val = headers[key];
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
}

function verifyWebhookSignature(secret: string, body: Buffer, signatureHeader: string): boolean {
  if (!signatureHeader.startsWith('sha256=')) return false;
  const expected = Buffer.from(signatureHeader.slice(7), 'hex');
  const actual = createHmac('sha256', secret).update(body).digest();
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function buildEventType(githubEvent: string, action?: string): GitHubEventType | null {
  const compound = action ? `${githubEvent}.${action}` : githubEvent;
  const valid: GitHubEventType[] = [
    'pull_request.opened',
    'pull_request.synchronize',
    'push',
    'issues.opened',
    'workflow_run.completed',
  ];
  return (valid as string[]).includes(compound) ? (compound as GitHubEventType) : null;
}

function matchesBranchFilter(filter: string[] | undefined, ref: string | undefined): boolean {
  if (!filter || filter.length === 0) return true;
  if (!ref) return false;
  const branch = ref.replace('refs/heads/', '');
  return filter.includes(branch);
}

function matchesPathFilter(filter: string[] | undefined, payload: GitHubEventPayload): boolean {
  if (!filter || filter.length === 0) return true;
  if (payload.pull_request) return true;
  const changedPaths: string[] = [];
  for (const commit of payload.commits ?? []) {
    changedPaths.push(...commit.added, ...commit.modified, ...commit.removed);
  }
  return changedPaths.some((p) => filter.some((f) => p.startsWith(f)));
}

function interpolatePrompt(template: string, ctx: AgentRoutingContext): string {
  return template
    .replace('{{repo}}', ctx.repoFullName)
    .replace('{{event}}', ctx.eventType)
    .replace('{{pr_number}}', String(ctx.payload.pull_request?.number ?? ''))
    .replace('{{issue_number}}', String(ctx.payload.issue?.number ?? ''))
    .replace('{{sha}}', ctx.payload.pull_request?.head.sha ?? '');
}

export class GitHubTriggerImpl implements GitHubTrigger {
  private readonly configs: Map<string, GitHubTriggerConfig> = new Map();
  private routeHandler: AgentRouteHandler | null = null;

  setRouteHandler(handler: AgentRouteHandler): void {
    this.routeHandler = handler;
  }

  register(appConfig: GitHubTriggerConfig): void {
    this.configs.set(appConfig.repoFullNameOwnerSlashRepo, appConfig);
  }

  listTriggers(): Array<{ repo: string; events: string[] }> {
    return Array.from(this.configs.values()).map((config) => ({
      repo: config.repoFullNameOwnerSlashRepo,
      events: config.events,
    }));
  }

  async handleWebhook(req: GitHubWebhookRequest): Promise<GitHubWebhookResult> {
    const signature = extractHeaderString(req.headers, 'x-hub-signature-256');
    const githubEvent = extractHeaderString(req.headers, 'x-github-event');
    const payload = JSON.parse(req.rawBody.toString('utf-8')) as GitHubEventPayload;
    const repoFullName = payload.repository?.full_name ?? '';

    const config = this.configs.get(repoFullName);
    if (!config) {
      return { handled: false };
    }

    if (!verifyWebhookSignature(config.webhookSecretForHmacVerification, req.rawBody, signature)) {
      throw new Error('Invalid webhook signature');
    }

    const eventType = buildEventType(githubEvent, payload.action);
    if (!eventType || !config.events.includes(eventType)) {
      return { handled: false };
    }

    const refForBranchFilter = payload.ref ?? payload.pull_request?.head.ref;
    if (!matchesBranchFilter(config.branchFilterUndefinedMeansAll, refForBranchFilter)) {
      return { handled: false };
    }

    if (!matchesPathFilter(config.pathFilterUndefinedMeansAll, payload)) {
      return { handled: false };
    }

    const ctx: AgentRoutingContext = {
      eventType,
      repoFullName,
      payload,
      prompt: '',
      autoApprove: config.autoApproveWithoutUserConfirmation,
    };
    ctx.prompt = interpolatePrompt(config.agentPromptTemplate, ctx);

    if (this.routeHandler) {
      const routeResult = await this.routeHandler(ctx);
      return {
        handled: true,
        eventType,
        repoFullName,
        sessionId: routeResult?.sessionId,
      };
    }

    return {
      handled: true,
      eventType,
      repoFullName,
    };
  }
}
