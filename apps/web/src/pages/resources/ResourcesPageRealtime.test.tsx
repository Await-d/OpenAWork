// @vitest-environment jsdom

import { useSyncExternalStore } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ResourceCatalog,
  ResourceCatalogEntry,
  UploadResourceInput,
} from '@openAwork/web-client';
import ResourcesPage from './ResourcesPage.js';

const hookStore = vi.hoisted(() => {
  type Listener = () => void;

  let currentResources: ResourceCatalog = {
    skills: [],
    agents: [],
    agentTemplates: [],
    commands: [],
    souls: [],
    prompts: [],
    extensions: [],
    mcps: [],
  };
  let currentDeletingId: string | null = null;
  const listeners = new Set<Listener>();

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function reset(): void {
    currentResources = {
      skills: [],
      agents: [],
      agentTemplates: [],
      commands: [],
      souls: [],
      prompts: [],
      extensions: [],
      mcps: [],
    };
    currentDeletingId = null;
    emit();
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function readFeature(area: UploadResourceInput['area']): ResourceCatalogEntry['feature'] {
    switch (area) {
      case 'souls':
        return 'channels';
      case 'agentTemplates':
        return 'team';
      case 'skills':
      case 'agents':
      case 'mcps':
      case 'extensions':
      case 'commands':
      case 'prompts':
        return area;
    }
  }

  function readUsageKind(area: UploadResourceInput['area']): ResourceCatalogEntry['usageKind'] {
    switch (area) {
      case 'souls':
        return 'channel-persona';
      case 'agentTemplates':
        return 'agent-template';
      case 'commands':
        return 'command-definition';
      case 'prompts':
        return 'runtime-instruction';
      case 'mcps':
        return 'mcp-server';
      case 'extensions':
        return 'extension-example';
      case 'agents':
        return 'agent';
      case 'skills':
        return 'skill';
    }
  }

  function baseEntry(input: UploadResourceInput): ResourceCatalogEntry {
    const catalogArea =
      input.area === 'skills' ||
      input.area === 'agents' ||
      input.area === 'mcps' ||
      input.area === 'extensions';
    return {
      id: `user-${input.area}-${input.name}`,
      name: input.name,
      description: input.description ?? '',
      integration: 'user',
      path: `user://${input.area}/${input.name}`,
      removable: true,
      source: 'user',
      visibility: catalogArea ? 'catalog' : 'feature',
      feature: readFeature(input.area),
      usageKind: readUsageKind(input.area),
    };
  }

  async function uploadResource(input: UploadResourceInput): Promise<void> {
    const base = baseEntry(input);
    if (input.area === 'prompts') {
      currentResources = {
        ...currentResources,
        prompts: [
          ...currentResources.prompts,
          { ...base, title: input.title, content: input.content },
        ],
      };
    }
    emit();
  }

  async function removeResource(resourceId: string): Promise<void> {
    currentDeletingId = resourceId;
    emit();
    currentResources = {
      ...currentResources,
      prompts: currentResources.prompts.filter((entry) => entry.id !== resourceId),
    };
    currentDeletingId = null;
    emit();
  }

  return {
    deletingId: () => currentDeletingId,
    removeResource: vi.fn(removeResource),
    reset,
    snapshot: () => currentResources,
    subscribe,
    uploadResource: vi.fn(uploadResource),
  };
});

vi.mock('../../hooks/resources/useResourceCatalog.js', () => ({
  useResourceCatalog: () => {
    const resources = useSyncExternalStore(
      hookStore.subscribe,
      hookStore.snapshot,
      hookStore.snapshot,
    );
    return {
      deletingId: hookStore.deletingId(),
      error: null,
      loading: false,
      mutating: false,
      reload: vi.fn(),
      removeResource: hookStore.removeResource,
      resources,
      uploadResource: hookStore.uploadResource,
    };
  },
}));

afterEach(() => {
  cleanup();
  hookStore.reset();
  hookStore.uploadResource.mockClear();
  hookStore.removeResource.mockClear();
});

describe('ResourcesPage realtime mutations', () => {
  it('上传功能专用资源后立即按用途识别并支持删除刷新', async () => {
    render(<ResourcesPage />);

    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'prompts' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'daily-summary' } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '每日总结' } });
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '用户上传提示词' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '总结今天的工作' } });

    const uploadForm = screen.getByRole('button', { name: '上传并识别' }).closest('form');
    if (!uploadForm) {
      throw new Error('未找到资源上传表单');
    }
    fireEvent.submit(uploadForm);

    expect(await screen.findByText('资源已加入目录，列表已刷新。')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /功能专用资源/ }));
    expect(screen.getAllByText('每日总结').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /每日总结/ }));
    expect(screen.getByText('运行提示词材料 · 按功能显式注入')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(hookStore.removeResource).toHaveBeenCalledWith('user-prompts-daily-summary');
    expect(screen.queryByText('每日总结')).toBeNull();
  });
});
