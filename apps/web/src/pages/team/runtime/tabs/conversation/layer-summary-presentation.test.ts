import { describe, expect, it } from 'vitest';
import {
  getLayerSummaryPresentation,
  pickLayerArtifactSequence,
  pickLayerPreferredArtifact,
} from './layer-summary-presentation.js';

describe('layer-summary-presentation', () => {
  it('PM2 / reviewer 优先展示 review 产物', () => {
    const result = pickLayerPreferredArtifact({
      planArtifact: { content: 'plan', title: 'plan' },
      reviewArtifact: { content: 'review', title: 'review' },
      roleLayer: 'pm2',
      specArtifact: { content: 'spec', title: 'spec' },
      tasksArtifact: { content: 'tasks', title: 'tasks' },
    });

    expect(result.phase).toBe('review');
    expect(result.artifact?.content).toBe('review');
  });

  it('executor 默认优先展示 tasks 产物', () => {
    const result = pickLayerPreferredArtifact({
      planArtifact: { content: 'plan', title: 'plan' },
      reviewArtifact: { content: 'review', title: 'review' },
      roleLayer: 'executor',
      specArtifact: { content: 'spec', title: 'spec' },
      tasksArtifact: { content: 'tasks', title: 'tasks' },
    });

    expect(result.phase).toBe('tasks');
    expect(result.artifact?.content).toBe('tasks');
  });

  it('PM1 的产物序列按 spec -> plan -> tasks 展示', () => {
    const result = pickLayerArtifactSequence({
      planArtifact: { content: 'plan', title: 'plan' },
      reviewArtifact: { content: 'review', title: 'review' },
      roleLayer: 'pm1',
      specArtifact: { content: 'spec', title: 'spec' },
      tasksArtifact: { content: 'tasks', title: 'tasks' },
    });

    expect(result.map((item) => item.phase)).toEqual(['spec', 'plan', 'tasks', 'review']);
  });

  it('为不同层提供不同摘要文案', () => {
    expect(getLayerSummaryPresentation('pm1').title).toBe('规划链摘要');
    expect(getLayerSummaryPresentation('pm1').artifactSectionTitle).toBe('规划产物链');
    expect(getLayerSummaryPresentation('pm1').dialogueFieldLabels.rewrittenIntent).toBe('规划入口');
    expect(getLayerSummaryPresentation('pm2').title).toBe('评审链摘要');
    expect(getLayerSummaryPresentation('pm2').artifactSectionTitle).toBe('评审产物链');
    expect(getLayerSummaryPresentation('pm2').dialogueFieldLabels.recommendedNextStep).toBe('评审建议');
    expect(getLayerSummaryPresentation('executor').title).toBe('执行链摘要');
    expect(getLayerSummaryPresentation('executor').dialogueSectionTitle).toBe('执行过程线索');
  });
});
