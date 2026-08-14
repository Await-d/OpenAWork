// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { KnowledgeGraph } from '../../data/build-knowledge-graph.js';
import { WorkspaceKnowledgeGraphCanvas } from './workspace-knowledge-graph-canvas.js';

function createMockCanvasContext(options: { onStroke?: (lineWidth: number) => void } = {}) {
  let lineWidth = 1;
  const context: Partial<CanvasRenderingContext2D> = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    fillText: vi.fn(),
    font: '',
    globalAlpha: 1,
    lineTo: vi.fn(),
    measureText: vi.fn((text: string) => ({
      width: text.length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 8,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 12,
      fontBoundingBoxDescent: 3,
      alphabeticBaseline: 0,
      emHeightAscent: 12,
      emHeightDescent: 3,
      hangingBaseline: 0,
      ideographicBaseline: 0,
    })),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    createLinearGradient: vi.fn(
      () =>
        ({
          addColorStop: vi.fn(),
        }) as unknown as CanvasGradient,
    ),
    createRadialGradient: vi.fn(
      () =>
        ({
          addColorStop: vi.fn(),
        }) as unknown as CanvasGradient,
    ),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(() => options.onStroke?.(lineWidth)),
    strokeStyle: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    translate: vi.fn(),
  };
  Object.defineProperty(context, 'lineWidth', {
    configurable: true,
    get: () => lineWidth,
    set: (value: number) => {
      lineWidth = value;
    },
  });
  return context as unknown as CanvasRenderingContext2D;
}

const graph: KnowledgeGraph = {
  nodes: [
    {
      content: null,
      detail: '工作区知识资产根节点',
      group: 'workspace',
      id: 'workspace:current',
      kind: 'workspace',
      label: '产品工作区',
      memoryType: null,
      persistedMemoryId: null,
      roleLayers: null,
      searchText: null,
      sourceRef: null,
      state: 'workspace',
    },
    {
      content: '# Spec\n目标用户与约束。',
      detail: '目标用户与约束。',
      group: 'knowledge',
      id: 'artifact:spec',
      kind: 'artifact',
      label: '需求规格',
      memoryType: 'project_context',
      persistedMemoryId: null,
      roleLayers: null,
      searchText: '目标用户与约束。',
      sourceRef: 'artifact:spec',
      state: 'spec',
    },
  ],
  edges: [
    {
      from: 'workspace:current',
      id: 'edge:workspace:current->artifact:spec',
      kind: 'contains',
      state: 'workspace',
      to: 'artifact:spec',
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkspaceKnowledgeGraphCanvas', () => {
  it('容器尺寸变化后会重绘 Canvas，避免冷却后比例失真', () => {
    let rectSize = { height: 420, width: 640 };
    let resizeCallback: ResizeObserverCallback | null = null;
    let resizeObserver: ResizeObserver | null = null;

    class MockResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
        resizeObserver = this;
      }

      disconnect = vi.fn();
      observe = vi.fn((_target: Element) => undefined);
      unobserve = vi.fn((_target: Element) => undefined);
    }

    const context = createMockCanvasContext();
    vi.stubGlobal('CanvasRenderingContext2D', Object);
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => context),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: rectSize.height,
      height: rectSize.height,
      left: 0,
      right: rectSize.width,
      toJSON: () => ({}),
      top: 0,
      width: rectSize.width,
      x: 0,
      y: 0,
    }));

    render(
      <WorkspaceKnowledgeGraphCanvas
        colorMode="group"
        forceSettings={{ center: 0.08, distance: 94, link: 0.18, repel: 185 }}
        graph={graph}
        labelDensity="auto"
        pan={{ x: 0, y: 0 }}
        resetVersion={0}
        selectedNodeId={null}
        zoom={1}
        onPanChange={vi.fn()}
        onSelectNode={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText('工作区知识图谱画布') as HTMLCanvasElement;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(420);

    rectSize = { height: 320, width: 512 };
    act(() => {
      if (resizeCallback && resizeObserver) {
        resizeCallback([], resizeObserver);
      }
    });

    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(320);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 512, 320);
  });

  it('选中节点后在画布上显示焦点摘要', () => {
    vi.stubGlobal('CanvasRenderingContext2D', Object);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => createMockCanvasContext()),
    });

    render(
      <WorkspaceKnowledgeGraphCanvas
        colorMode="group"
        forceSettings={{ center: 0.08, distance: 94, link: 0.18, repel: 185 }}
        graph={graph}
        labelDensity="auto"
        pan={{ x: 0, y: 0 }}
        resetVersion={0}
        selectedNodeId="artifact:spec"
        zoom={1}
        onPanChange={vi.fn()}
        onSelectNode={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );

    expect(screen.getByText('焦点：需求规格 · 产物 · spec')).toBeTruthy();
  });

  it('hover 节点只做焦点高亮，不会冒充真实选中描边', () => {
    const strokeWidths: number[] = [];
    vi.stubGlobal('CanvasRenderingContext2D', Object);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() =>
        createMockCanvasContext({
          onStroke: (lineWidth) => strokeWidths.push(lineWidth),
        }),
      ),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 560,
      height: 560,
      left: 0,
      right: 960,
      toJSON: () => ({}),
      top: 0,
      width: 960,
      x: 0,
      y: 0,
    }));

    render(
      <WorkspaceKnowledgeGraphCanvas
        colorMode="group"
        forceSettings={{ center: 0.08, distance: 94, link: 0.18, repel: 185 }}
        graph={graph}
        labelDensity="auto"
        pan={{ x: 0, y: 0 }}
        resetVersion={0}
        selectedNodeId="artifact:spec"
        zoom={1}
        onPanChange={vi.fn()}
        onSelectNode={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText('工作区知识图谱画布');
    strokeWidths.length = 0;
    fireEvent.pointerMove(canvas, { clientX: 480, clientY: 280, pointerId: 1 });

    expect(screen.getByText('焦点：产品工作区 · 工作区知识资产根节点')).toBeTruthy();
    expect(strokeWidths.some((width) => width > 1.2)).toBe(true);
    expect(strokeWidths.some((width) => width > 1 && width < 1.2)).toBe(true);
  });

  it('拖出画布释放后会清理 hover 焦点，避免旧节点提示残留', () => {
    vi.stubGlobal('CanvasRenderingContext2D', Object);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => createMockCanvasContext()),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 560,
      height: 560,
      left: 0,
      right: 960,
      toJSON: () => ({}),
      top: 0,
      width: 960,
      x: 0,
      y: 0,
    }));

    render(
      <WorkspaceKnowledgeGraphCanvas
        colorMode="group"
        forceSettings={{ center: 0.08, distance: 94, link: 0.18, repel: 185 }}
        graph={graph}
        labelDensity="auto"
        pan={{ x: 0, y: 0 }}
        resetVersion={0}
        selectedNodeId="artifact:spec"
        zoom={1}
        onPanChange={vi.fn()}
        onSelectNode={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText('工作区知识图谱画布');
    expect(screen.getByText('焦点：需求规格 · 产物 · spec')).toBeTruthy();

    fireEvent.pointerMove(canvas, { clientX: 480, clientY: 280, pointerId: 1 });
    expect(screen.getByText('焦点：产品工作区 · 工作区知识资产根节点')).toBeTruthy();

    fireEvent.pointerDown(canvas, { button: 0, clientX: 480, clientY: 280, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: -120, clientY: -120, pointerId: 1 });
    fireEvent.pointerLeave(canvas, { clientX: -120, clientY: -120, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: -120, clientY: -120, pointerId: 1 });

    expect(screen.getByText('焦点：需求规格 · 产物 · spec')).toBeTruthy();
    expect(screen.queryByText('焦点：产品工作区 · 工作区知识资产根节点')).toBeNull();
  });

  it('Canvas 点击节点时在释放后才触发选择，避免拖拽前先裁剪局部图', () => {
    const onSelectNode = vi.fn();
    vi.stubGlobal('CanvasRenderingContext2D', Object);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => createMockCanvasContext()),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 560,
      height: 560,
      left: 0,
      right: 960,
      toJSON: () => ({}),
      top: 0,
      width: 960,
      x: 0,
      y: 0,
    }));

    render(
      <WorkspaceKnowledgeGraphCanvas
        colorMode="group"
        forceSettings={{ center: 0.08, distance: 94, link: 0.18, repel: 185 }}
        graph={graph}
        labelDensity="auto"
        pan={{ x: 0, y: 0 }}
        resetVersion={0}
        selectedNodeId={null}
        zoom={1}
        onPanChange={vi.fn()}
        onSelectNode={onSelectNode}
        onZoomChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText('工作区知识图谱画布');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 480, clientY: 280, pointerId: 1 });
    expect(onSelectNode).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(onSelectNode).toHaveBeenCalledWith('workspace:current');
  });

  it('Canvas 拖动节点不会触发节点选择', () => {
    const onSelectNode = vi.fn();
    vi.stubGlobal('CanvasRenderingContext2D', Object);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => createMockCanvasContext()),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 560,
      height: 560,
      left: 0,
      right: 960,
      toJSON: () => ({}),
      top: 0,
      width: 960,
      x: 0,
      y: 0,
    }));

    render(
      <WorkspaceKnowledgeGraphCanvas
        colorMode="group"
        forceSettings={{ center: 0.08, distance: 94, link: 0.18, repel: 185 }}
        graph={graph}
        labelDensity="auto"
        pan={{ x: 0, y: 0 }}
        resetVersion={0}
        selectedNodeId={null}
        zoom={1}
        onPanChange={vi.fn()}
        onSelectNode={onSelectNode}
        onZoomChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText('工作区知识图谱画布');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 480, clientY: 280, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 520, clientY: 320, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('Canvas 拖动节点后显示固定布局提示', () => {
    vi.stubGlobal('CanvasRenderingContext2D', Object);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => createMockCanvasContext()),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 560,
      height: 560,
      left: 0,
      right: 960,
      toJSON: () => ({}),
      top: 0,
      width: 960,
      x: 0,
      y: 0,
    }));

    render(
      <WorkspaceKnowledgeGraphCanvas
        colorMode="group"
        forceSettings={{ center: 0.08, distance: 94, link: 0.18, repel: 185 }}
        graph={graph}
        labelDensity="auto"
        pan={{ x: 0, y: 0 }}
        resetVersion={0}
        selectedNodeId={null}
        zoom={1}
        onPanChange={vi.fn()}
        onSelectNode={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText('工作区知识图谱画布');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 480, clientY: 280, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 520, clientY: 320, pointerId: 1 });

    expect(screen.getByText('固定 1 · 复位恢复自动布局')).toBeTruthy();
  });

  it('Canvas 背景拖拽会平移视图，不触发节点选择', () => {
    const onPanChange = vi.fn();
    const onSelectNode = vi.fn();
    vi.stubGlobal('CanvasRenderingContext2D', Object);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => createMockCanvasContext()),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 560,
      height: 560,
      left: 0,
      right: 960,
      toJSON: () => ({}),
      top: 0,
      width: 960,
      x: 0,
      y: 0,
    }));

    render(
      <WorkspaceKnowledgeGraphCanvas
        colorMode="group"
        forceSettings={{ center: 0.08, distance: 94, link: 0.18, repel: 185 }}
        graph={graph}
        labelDensity="auto"
        pan={{ x: 0, y: 0 }}
        resetVersion={0}
        selectedNodeId={null}
        zoom={1}
        onPanChange={onPanChange}
        onSelectNode={onSelectNode}
        onZoomChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText('工作区知识图谱画布');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 80, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 110, clientY: 115, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    expect(onPanChange).toHaveBeenCalledWith({ x: 30, y: 35 });
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('Canvas 滚轮会直接缩放并保持鼠标指向的图谱位置稳定', () => {
    const onPanChange = vi.fn();
    const onZoomChange = vi.fn();
    vi.stubGlobal('CanvasRenderingContext2D', Object);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => createMockCanvasContext()),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 560,
      height: 560,
      left: 0,
      right: 960,
      toJSON: () => ({}),
      top: 0,
      width: 960,
      x: 0,
      y: 0,
    }));

    render(
      <WorkspaceKnowledgeGraphCanvas
        colorMode="group"
        forceSettings={{ center: 0.08, distance: 94, link: 0.18, repel: 185 }}
        graph={graph}
        labelDensity="auto"
        pan={{ x: 0, y: 0 }}
        resetVersion={0}
        selectedNodeId={null}
        zoom={1}
        onPanChange={onPanChange}
        onSelectNode={vi.fn()}
        onZoomChange={onZoomChange}
      />,
    );

    const canvas = screen.getByLabelText('工作区知识图谱画布');
    fireEvent.wheel(canvas, { clientX: 480, clientY: 280, deltaY: 120 });
    const firstPan = onPanChange.mock.calls[0]?.[0] as { x: number; y: number } | undefined;
    expect(firstPan?.x).toBeCloseTo(57.6);
    expect(firstPan?.y).toBeCloseTo(33.6);
    expect(onZoomChange).toHaveBeenCalledWith(0.88);

    fireEvent.wheel(canvas, { clientX: 480, clientY: 280, deltaY: -200 });
    expect(onZoomChange).toHaveBeenCalledWith(1.2);
  });
});
