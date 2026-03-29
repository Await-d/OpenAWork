import { HttpError } from '@openAwork/web-client';

export function isSessionAlreadyDeletedError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}
