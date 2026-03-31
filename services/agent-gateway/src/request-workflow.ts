import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  WorkflowLogger,
  createRequestContext,
  type RequestContext,
  type WorkflowStep,
} from '@openAwork/logger';
import { persistRequestWorkflowLog } from './request-workflow-log-store.js';

type WorkflowFields = Record<string, string | number | boolean>;

type WorkflowChildSuffix<TRoot extends string, TSuffix extends string> = TSuffix extends ''
  ? never
  : TSuffix extends TRoot
    ? never
    : TSuffix extends `${TRoot}.${string}`
      ? never
      : TSuffix;

type ActiveRequestWorkflow = {
  workflowLogger: WorkflowLogger;
  workflowContext: RequestContext;
  workflowRequestStep: WorkflowStep;
};

export type RequestWorkflowStep<TName extends string = string> = {
  child: <const TSuffix extends string>(
    suffix: WorkflowChildSuffix<TName, TSuffix>,
    message?: string,
    fields?: WorkflowFields,
  ) => RequestWorkflowStep<`${TName}.${TSuffix}`>;
  fail: (message?: string, fields?: WorkflowFields) => void;
  name: TName;
  step: WorkflowStep;
  succeed: (message?: string, fields?: WorkflowFields) => void;
};

export type RequestWorkflowScope<TRoot extends string> = {
  child: <const TSuffix extends string>(
    suffix: WorkflowChildSuffix<TRoot, TSuffix>,
    message?: string,
    fields?: WorkflowFields,
  ) => RequestWorkflowStep<`${TRoot}.${TSuffix}`>;
  root: TRoot;
  step: RequestWorkflowStep<TRoot>;
  succeed: (message?: string, fields?: WorkflowFields) => void;
  fail: (message?: string, fields?: WorkflowFields) => void;
  workflowLogger: WorkflowLogger;
  workflowContext: RequestContext;
  workflowRequestStep: WorkflowStep;
};

type StoredRequestWorkflow = ActiveRequestWorkflow & {
  workflowLogFlushed: boolean;
};

const requestWorkflows = new WeakMap<FastifyRequest, StoredRequestWorkflow>();

const resolveRequestPath = (url: string): string => url.split('?')[0] ?? url;

export function getRequestWorkflow(request: FastifyRequest): ActiveRequestWorkflow {
  const workflow = requestWorkflows.get(request);
  if (!workflow) {
    throw new Error('Request workflow logger not initialized');
  }

  return {
    workflowLogger: workflow.workflowLogger,
    workflowContext: workflow.workflowContext,
    workflowRequestStep: workflow.workflowRequestStep,
  };
}

export function startRequestStep(
  request: FastifyRequest,
  name: string,
  message?: string,
  fields?: WorkflowFields,
): WorkflowStep {
  const { workflowLogger, workflowRequestStep } = getRequestWorkflow(request);
  return workflowLogger.startChild(workflowRequestStep, name, message, fields);
}

function assertWorkflowChildSuffix(root: string, suffix: string): void {
  if (suffix.length === 0) {
    throw new Error('Workflow child suffix must be non-empty');
  }

  if (suffix === root || suffix.startsWith(`${root}.`)) {
    throw new Error(
      `Workflow child suffix must not repeat the root prefix: root=${root} suffix=${suffix}`,
    );
  }
}

function createRequestWorkflowStep<TName extends string>(
  activeWorkflow: ActiveRequestWorkflow,
  name: TName,
  step: WorkflowStep,
): RequestWorkflowStep<TName> {
  return {
    child: <const TSuffix extends string>(
      suffix: WorkflowChildSuffix<TName, TSuffix>,
      message?: string,
      fields?: WorkflowFields,
    ): RequestWorkflowStep<`${TName}.${TSuffix}`> => {
      assertWorkflowChildSuffix(name, suffix);
      const childName = `${name}.${suffix}` as `${TName}.${TSuffix}`;
      const childStep = activeWorkflow.workflowLogger.startChild(step, childName, message, fields);
      return createRequestWorkflowStep(activeWorkflow, childName, childStep);
    },
    fail: (message?: string, fields?: WorkflowFields): void => {
      activeWorkflow.workflowLogger.fail(step, message, fields);
    },
    name,
    step,
    succeed: (message?: string, fields?: WorkflowFields): void => {
      activeWorkflow.workflowLogger.succeed(step, message, fields);
    },
  };
}

function settlePendingWorkflowStep(
  workflowLogger: WorkflowLogger,
  step: WorkflowStep,
  outcome: 'success' | 'error',
  message?: string,
  fields?: WorkflowFields,
): void {
  if (step.children) {
    for (const child of step.children) {
      settlePendingWorkflowStep(workflowLogger, child, outcome, message, fields);
    }
  }

  if (step.status !== 'pending') {
    return;
  }

  if (outcome === 'error') {
    workflowLogger.fail(step, message, fields);
    return;
  }

  workflowLogger.succeed(step, message, fields);
}

export function startRequestWorkflow<const TRoot extends string>(
  request: FastifyRequest,
  root: TRoot,
  message?: string,
  fields?: WorkflowFields,
): RequestWorkflowScope<TRoot> {
  const activeWorkflow = getRequestWorkflow(request);
  const step = createRequestWorkflowStep(
    activeWorkflow,
    root,
    startRequestStep(request, root, message, fields),
  );

  return {
    child: step.child,
    fail: step.fail,
    root,
    step,
    succeed: step.succeed,
    workflowLogger: activeWorkflow.workflowLogger,
    workflowContext: activeWorkflow.workflowContext,
    workflowRequestStep: activeWorkflow.workflowRequestStep,
  };
}

function flushRequestWorkflow(request: FastifyRequest, statusCode: number, message?: string): void {
  const workflow = requestWorkflows.get(request);
  if (!workflow || workflow.workflowLogFlushed) {
    return;
  }

  const fields = { statusCode };
  settlePendingWorkflowStep(
    workflow.workflowLogger,
    workflow.workflowRequestStep,
    statusCode >= 400 ? 'error' : 'success',
    message,
    fields,
  );

  const userId =
    typeof (request as { user?: { sub?: unknown } }).user?.sub === 'string'
      ? ((request as { user?: { sub?: string } }).user?.sub ?? null)
      : null;
  persistRequestWorkflowLog({
    context: workflow.workflowContext,
    steps: [workflow.workflowRequestStep],
    statusCode,
    userId,
  });

  workflow.workflowLogger.flush(workflow.workflowContext, statusCode);
  workflow.workflowLogFlushed = true;
  requestWorkflows.delete(request);
}

const requestWorkflowPlugin = fp(async (app) => {
  app.addHook('onRequest', async (request) => {
    const workflowLogger = new WorkflowLogger();
    const workflowContext = createRequestContext(
      request.method,
      request.url,
      request.headers as Record<string, string | string[] | undefined>,
      request.ip,
    );
    const workflowRequestStep = workflowLogger.start('request.handle', undefined, {
      method: request.method,
      path: resolveRequestPath(request.url),
    });

    requestWorkflows.set(request, {
      workflowLogger,
      workflowContext,
      workflowRequestStep,
      workflowLogFlushed: false,
    });
  });

  app.addHook('onError', async (request, _reply, error) => {
    const workflow = requestWorkflows.get(request);
    if (!workflow) {
      return;
    }

    settlePendingWorkflowStep(
      workflow.workflowLogger,
      workflow.workflowRequestStep,
      'error',
      error.message,
    );
  });

  app.addHook('onTimeout', async (request) => {
    flushRequestWorkflow(request, 408, 'request timeout');
  });

  app.addHook('onRequestAbort', async (request) => {
    flushRequestWorkflow(request, 499, 'request aborted');
  });

  app.addHook('onResponse', async (request, reply) => {
    flushRequestWorkflow(request, reply.statusCode);
  });
});

export default requestWorkflowPlugin;
