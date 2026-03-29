import { z } from 'zod';

export const fileDiffSchema = z
  .object({
    file: z.string(),
    before: z.string(),
    after: z.string(),
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    status: z.enum(['added', 'deleted', 'modified']).optional(),
  })
  .strict();

export type FileDiffOutput = z.infer<typeof fileDiffSchema>;

export function buildFileDiff(input: {
  after: string;
  before: string;
  file: string;
}): FileDiffOutput {
  const beforeLines = input.before.replace(/\r\n/g, '\n').split('\n');
  const afterLines = input.after.replace(/\r\n/g, '\n').split('\n');
  let additions = 0;
  let deletions = 0;
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const beforeLine = beforeLines[beforeIndex];
    const afterLine = afterLines[afterIndex];

    if (beforeLine === afterLine && beforeLine !== undefined) {
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (
      beforeLine !== undefined &&
      afterLine !== undefined &&
      beforeLines[beforeIndex + 1] === afterLine
    ) {
      deletions += 1;
      beforeIndex += 1;
      continue;
    }

    if (
      beforeLine !== undefined &&
      afterLine !== undefined &&
      afterLines[afterIndex + 1] === beforeLine
    ) {
      additions += 1;
      afterIndex += 1;
      continue;
    }

    if (beforeLine !== undefined) {
      deletions += 1;
      beforeIndex += 1;
    }
    if (afterLine !== undefined) {
      additions += 1;
      afterIndex += 1;
    }
  }

  const status =
    input.before.length === 0 && input.after.length > 0
      ? 'added'
      : input.before.length > 0 && input.after.length === 0
        ? 'deleted'
        : 'modified';

  return {
    file: input.file,
    before: input.before,
    after: input.after,
    additions,
    deletions,
    status,
  };
}
