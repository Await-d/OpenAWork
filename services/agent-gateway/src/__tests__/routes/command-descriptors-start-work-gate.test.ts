import { describe, expect, it } from 'vitest';
import { buildCommandDescriptors } from '../../routes/command-descriptors.js';

describe('start-work gate command descriptors', () => {
  it('暴露 executor done claim 与 reviewer verdict 两个 server slash 命令', () => {
    const byId = new Map(buildCommandDescriptors().map((command) => [command.id, command]));

    expect(byId.get('slash-start-work-done')).toMatchObject({
      action: { kind: 'submit_start_work_done_claim' },
      execution: 'server',
      label: '/start-work-done',
    });
    expect(byId.get('slash-start-work-review')).toMatchObject({
      action: { kind: 'review_start_work_done_claim' },
      execution: 'server',
      label: '/start-work-review',
    });
  });
});
