// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandoffEntry } from '../../../../../stores/team/team-events.js';
import { LayerFlowPipeline, type EdgeView, type LayerNodeView } from './LayerFlowPipeline.js';

const receptionToPm1: HandoffEntry = {
  id: 'handoff-reception-pm1',
  state: 'completed',
  fromRoleLayer: 'reception',
  toRoleLayer: 'pm1',
  fromSessionId: 'root',
  toSessionId: 'sess-pm1',
  sessionId: 'sess-pm1',
  summary: '接待交给规划',
  updatedAt: 1000,
};

const pm1ToPm2: HandoffEntry = {
  id: 'handoff-pm1-pm2',
  state: 'running',
  fromRoleLayer: 'pm1',
  toRoleLayer: 'pm2',
  fromSessionId: 'sess-pm1',
  toSessionId: 'sess-pm2',
  sessionId: 'sess-pm2',
  summary: '规划交给管控',
  updatedAt: 2000,
};

const filteredLayerViews: LayerNodeView[] = [
  {
    active: false,
    inboundCount: 1,
    layer: 'pm1',
    roleInstances: [],
    sessionId: 'sess-pm1',
    state: 'completed',
  },
  {
    active: true,
    inboundCount: 1,
    layer: 'pm2',
    roleInstances: [],
    sessionId: 'sess-pm2',
    state: 'running',
  },
];

const fullEdges: EdgeView[] = [
  {
    active: false,
    fromIndex: 0,
    latest: receptionToPm1,
    state: 'completed',
    toIndex: 1,
  },
  {
    active: true,
    fromIndex: 1,
    latest: pm1ToPm2,
    state: 'running',
    toIndex: 2,
  },
];

describe('LayerFlowPipeline', () => {
  afterEach(() => cleanup());

  it('过滤后的可见节点使用原始层级索引匹配边点击目标', () => {
    const onSelectHandoff = vi.fn();

    render(
      <LayerFlowPipeline
        edges={fullEdges}
        layerViews={filteredLayerViews}
        selectedSessionId={null}
        onSelectHandoff={onSelectHandoff}
        onSelectLayer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看该层间消息详情' }));

    expect(onSelectHandoff).toHaveBeenCalledOnce();
    expect(onSelectHandoff).toHaveBeenCalledWith(pm1ToPm2);
  });
});
