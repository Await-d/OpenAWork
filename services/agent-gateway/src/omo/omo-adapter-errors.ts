import type { ZodError, ZodIssue } from 'zod';

export const OMO_MANIFEST_ERROR_CODES = ['invalid_schema', 'duplicate_id'] as const;

export type OmoManifestErrorCode = (typeof OMO_MANIFEST_ERROR_CODES)[number];

export type OmoManifestIssue = {
  readonly path: readonly (string | number)[];
  readonly message: string;
};

export class OmoManifestError extends Error {
  override readonly name = 'OmoManifestError';
  readonly code: OmoManifestErrorCode;
  readonly issues: readonly OmoManifestIssue[];
  readonly sourcePath: string | undefined;

  constructor(input: {
    readonly code: OmoManifestErrorCode;
    readonly issues: readonly OmoManifestIssue[];
    readonly sourcePath?: string;
  }) {
    super(buildOmoManifestErrorMessage(input.code, input.issues, input.sourcePath));
    this.code = input.code;
    this.issues = input.issues;
    this.sourcePath = input.sourcePath;
  }
}

export function zodToOmoManifestError(
  error: ZodError,
  input: { readonly sourcePath?: string } = {},
): OmoManifestError {
  return new OmoManifestError({
    code: 'invalid_schema',
    issues: error.issues.map(toOmoManifestIssue),
    sourcePath: input.sourcePath,
  });
}

export function duplicateOmoManifestIdError(input: {
  readonly id: string;
  readonly path: readonly (string | number)[];
  readonly sourcePath?: string;
}): OmoManifestError {
  return new OmoManifestError({
    code: 'duplicate_id',
    issues: [{ path: input.path, message: `Duplicate OMO manifest id: ${input.id}` }],
    sourcePath: input.sourcePath,
  });
}

function toOmoManifestIssue(issue: ZodIssue): OmoManifestIssue {
  return {
    path: issue.path,
    message: issue.message,
  };
}

function buildOmoManifestErrorMessage(
  code: OmoManifestErrorCode,
  issues: readonly OmoManifestIssue[],
  sourcePath: string | undefined,
): string {
  const location = sourcePath ? `${sourcePath}: ` : '';
  const firstIssue = issues[0];
  const detail = firstIssue ? firstIssue.message : 'OMO manifest parse failed';
  return `${location}${code}: ${detail}`;
}
