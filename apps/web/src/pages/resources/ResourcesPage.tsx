import { useActionState, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ResourceArea, UploadResourceInput } from '@openAwork/web-client';
import { useResourceCatalog } from '../../hooks/resources/useResourceCatalog.js';
import { ResourcesBrowserPanel } from './ResourcesBrowserPanel.js';
import { ResourcesCommandBar } from './ResourcesCommandBar.js';
import { ResourcesFeatureStrip } from './ResourcesFeatureStrip.js';
import { ResourcesPreviewPanel } from './ResourcesPreviewPanel.js';
import { ResourcesScopeNav } from './ResourcesScopeNav.js';
import { ResourcesUploadPanel } from './ResourcesUploadPanel.js';
import {
  FEATURE_RESOURCE_AREA_OPTIONS,
  RESOURCE_AREA_OPTIONS,
  filterResourceItems,
  splitResourceCenterItems,
  type ResourceCenterScope,
} from './resource-center-utils.js';
import {
  INITIAL_FORM_STATE,
  formArea,
  formString,
  type UploadFormState,
} from './resources-page-form.js';
import './resources-page.css';

export default function ResourcesPage() {
  const {
    resources,
    loading,
    mutating,
    deletingId,
    error,
    reload,
    uploadResource,
    removeResource,
  } = useResourceCatalog();
  const [activeScope, setActiveScope] = useState<ResourceCenterScope>('catalog');
  const [activeArea, setActiveArea] = useState<ResourceArea | 'all'>('all');
  const [query, setQuery] = useState('');
  const { catalogItems, featureItems } = useMemo(
    () => splitResourceCenterItems(resources),
    [resources],
  );
  const items = activeScope === 'catalog' ? catalogItems : featureItems;
  const areaOptions =
    activeScope === 'catalog' ? RESOURCE_AREA_OPTIONS : FEATURE_RESOURCE_AREA_OPTIONS;
  const filteredItems = useMemo(
    () => filterResourceItems(items, activeArea, query),
    [activeArea, items, query],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedItem =
    filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null;

  const allItems = [...catalogItems, ...featureItems];
  const userCount = allItems.filter((item) => item.integration === 'user').length;
  const channelPersonaCount = featureItems.filter((item) => item.feature === 'channels').length;

  const [formState, uploadAction, isUploadPending] = useActionState(
    async (_previous: UploadFormState, formData: FormData): Promise<UploadFormState> => {
      const input: UploadResourceInput = {
        area: formArea(formData),
        name: formString(formData, 'name'),
        title: formString(formData, 'title'),
        description: formString(formData, 'description'),
        content: formString(formData, 'content'),
      };
      try {
        await uploadResource(input);
        return { status: 'saved', message: '资源已加入目录，列表已刷新。' };
      } catch (reason: unknown) {
        return {
          status: 'idle',
          message: reason instanceof Error ? reason.message : '上传资源失败',
        };
      }
    },
    INITIAL_FORM_STATE,
  );

  function handleAreaChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.currentTarget.value;
    const next = areaOptions.find((option) => option.value === value)?.value ?? 'all';
    setActiveArea(next);
    setSelectedId(null);
  }

  function handleQueryChange(nextQuery: string): void {
    setQuery(nextQuery);
    setSelectedId(null);
  }

  function handleScopeChange(scope: ResourceCenterScope): void {
    setActiveScope(scope);
    setActiveArea('all');
    setSelectedId(null);
  }

  return (
    <main className="resources-page" aria-labelledby="resources-title">
      <ResourcesCommandBar
        catalogCount={catalogItems.length}
        featureCount={featureItems.length}
        channelPersonaCount={channelPersonaCount}
        userCount={userCount}
        loading={loading}
        onReload={reload}
      />

      {error ? <div className="resources-alert">{error}</div> : null}

      <ResourcesScopeNav activeScope={activeScope} onScopeChange={handleScopeChange} />
      <ResourcesFeatureStrip />

      <section className="resources-shell">
        <ResourcesBrowserPanel
          activeArea={activeArea}
          activeScope={activeScope}
          areaOptions={areaOptions}
          filteredItems={filteredItems}
          loading={loading}
          query={query}
          selectedItem={selectedItem}
          onAreaChange={handleAreaChange}
          onQueryChange={handleQueryChange}
          onSelectItem={setSelectedId}
        />
        <ResourcesPreviewPanel
          deletingId={deletingId}
          selectedItem={selectedItem}
          onRemoveResource={(id) => void removeResource(id)}
        />
        <ResourcesUploadPanel
          formAction={uploadAction}
          formState={formState}
          isBusy={mutating || isUploadPending}
        />
      </section>
    </main>
  );
}
