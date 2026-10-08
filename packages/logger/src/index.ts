export type {
  LogLevel,
  StepStatus,
  WorkflowStep,
  RequestContext,
  LogEntry,
  LoggerOptions,
} from './types.js';
export { WorkflowLogger } from './workflow-logger.js';
export { FrontendLogger } from './frontend-logger.js';
export {
  createRequestContext,
  resolveRequestId,
  generateRequestId,
  REQUEST_ID_HEADER,
} from './fastify-plugin.js';
export type { RequestLoggerDecorators } from './fastify-plugin.js';
export { redactLogText, redactLogFields } from './redaction.js';
export {
  ClientErrorRecorder,
  installGlobalErrorCapture,
  describeClientError,
} from './client-error-capture.js';
export type {
  ClientErrorRecord,
  ClientErrorSink,
  ClientErrorSource,
  ClientErrorRecorderOptions,
  DescribeClientErrorResult,
  InstallGlobalErrorCaptureOptions,
} from './client-error-capture.js';
