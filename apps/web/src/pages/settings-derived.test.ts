import { describe, expect, it } from 'vitest';
import {
  buildAuditExportContent,
  buildDevEventsFromLogs,
  groupDiagnosticsByFile,
} from './settings-derived.js';

describe('settings-derived', () => {
  it('maps log entries into developer mode events', () => {
    const events = buildDevEventsFromLogs([
      { level: 'error', message: 'Tool failed', timestamp: 1000, source: 'gateway' },
      { level: 'info', message: 'Tool called', timestamp: 2000, source: 'gateway' },
    ]);

    expect(events).toEqual([
      expect.objectContaining({ type: 'error', label: 'Tool failed' }),
      expect.objectContaining({ type: 'raw', label: 'Tool called' }),
    ]);
  });

  it('groups diagnostics by file path for card rendering', () => {
    const groups = groupDiagnosticsByFile([
      { filePath: 'web_search', message: 'Tool error A', severity: 'error' },
      { filePath: 'web_search', message: 'Tool error B', severity: 'error' },
      { filePath: 'lsp_diagnostics', message: 'Tool error C', severity: 'error' },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ filePath: 'web_search' });
    expect(groups[0]?.diagnostics).toHaveLength(2);
  });

  it('exports logs as markdown and json content', () => {
    const logs = [
      {
        level: 'info' as const,
        message: 'Tool called',
        timestamp: 2000,
        source: 'gateway',
      },
    ];

    expect(buildAuditExportContent(logs, 'json')).toContain('Tool called');
    expect(buildAuditExportContent(logs, 'markdown')).toContain('| info | Tool called |');
  });
});
