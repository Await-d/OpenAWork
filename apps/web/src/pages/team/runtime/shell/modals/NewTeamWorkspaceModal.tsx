import { useMemo, useState } from 'react';
import { createTeamPhaseAClient, createWorkspaceClient } from '@openAwork/web-client';
import WorkspacePickerModal from '../../../../../components/common/modal/WorkspacePickerModal.js';
import { buildWorkspacePickerDataSource } from '../../../../../components/common/modal/workspace-picker-data-source.js';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { NewTeamWorkspaceForm } from './NewTeamWorkspaceForm.js';
import { NewTeamWorkspaceHero } from './NewTeamWorkspaceHero.js';
import { buildWorkspaceTemplateKnowledgeInput } from './new-team-workspace-agent-templates.js';
import { MODAL_STYLE, OVERLAY_STYLE } from './new-team-workspace-modal-config.js';
import { useNewTeamWorkspaceAgentTemplates } from './use-new-team-workspace-agent-templates.js';
import './new-team-workspace-modal.css';

export interface NewTeamWorkspaceModalProps {
  onClose: () => void;
  onCreated?: (newWorkspaceId?: string) => void;
}

export function NewTeamWorkspaceModal({ onClose, onCreated }: NewTeamWorkspaceModalProps) {
  const data = useTeamRuntimeReferenceViewData();
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);
  const teamPhaseAClient = useMemo(() => createTeamPhaseAClient(gatewayUrl), [gatewayUrl]);
  const templates = useNewTeamWorkspaceAgentTemplates({ accessToken, gatewayUrl });
  const workspacePickerDataSource = useMemo(
    () =>
      buildWorkspacePickerDataSource({
        client: workspaceClient,
        token: accessToken,
      }),
    [accessToken, workspaceClient],
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultWorkingRoot, setDefaultWorkingRoot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const existingNames = useMemo(() => {
    const names = new Set<string>();
    for (const workspace of data.workspaces) {
      names.add(workspace.name.trim().toLowerCase());
    }
    return names;
  }, [data.workspaces]);

  const trimmedName = name.trim();
  const nameError = useMemo(() => {
    if (!trimmedName) {
      return null;
    }
    if (existingNames.has(trimmedName.toLowerCase())) {
      return `名称「${trimmedName}」已存在，请换一个`;
    }
    return null;
  }, [existingNames, trimmedName]);

  const canSubmit = trimmedName.length > 0 && !nameError && !submitting;

  const handleSubmit = async () => {
    if (!trimmedName) {
      setError('工作区名称必填');
      return;
    }
    if (nameError) {
      setError(nameError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const newWorkspaceId = await data.createWorkspace({
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(defaultWorkingRoot.trim() ? { defaultWorkingRoot: defaultWorkingRoot.trim() } : {}),
      });
      if (!newWorkspaceId) {
        setError('创建失败，请重试或检查权限');
        return;
      }

      if (templates.selectedTemplates.length > 0) {
        if (!accessToken) {
          setError('工作区已创建，但当前登录状态不可用，无法初始化模板');
          return;
        }
        try {
          for (const template of templates.selectedTemplates) {
            await teamPhaseAClient.upsertWorkspaceKnowledge(
              accessToken,
              newWorkspaceId,
              buildWorkspaceTemplateKnowledgeInput(template),
            );
          }
        } catch (reason) {
          setError(
            reason instanceof Error
              ? `工作区已创建，但模板初始化失败：${reason.message}`
              : '工作区已创建，但模板初始化失败',
          );
          return;
        }
      }

      onCreated?.(newWorkspaceId);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePathSelect = async (path: string) => {
    setDefaultWorkingRoot(path);
    if (!name.trim()) {
      const folderName = extractFolderName(path);
      if (folderName) {
        setName(nextWorkspaceName(folderName, existingNames));
      }
    }
    setShowPicker(false);
  };

  return (
    <>
      <div style={OVERLAY_STYLE}>
        <button
          type="button"
          aria-label="关闭新建工作区弹窗"
          onClick={onClose}
          style={{
            position: 'absolute',
            inset: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
          }}
        />
        <div style={MODAL_STYLE} role="dialog" aria-modal="true" aria-labelledby="new-ws-title">
          <NewTeamWorkspaceHero />
          <NewTeamWorkspaceForm
            canSubmit={canSubmit}
            defaultWorkingRoot={defaultWorkingRoot}
            description={description}
            error={error}
            name={name}
            nameError={nameError}
            submitting={submitting}
            templates={templates}
            onClose={onClose}
            onDefaultWorkingRootChange={setDefaultWorkingRoot}
            onDescriptionChange={setDescription}
            onNameChange={(value) => {
              setName(value);
              if (error) {
                setError(null);
              }
            }}
            onOpenPicker={() => setShowPicker(true)}
            onSubmit={() => void handleSubmit()}
          />
        </div>
      </div>
      <WorkspacePickerModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handlePathSelect}
        fetchRootPath={workspacePickerDataSource.fetchRootPath}
        fetchWorkspaceRoots={workspacePickerDataSource.fetchWorkspaceRoots}
        fetchTree={workspacePickerDataSource.fetchTree}
        createDirectory={workspacePickerDataSource.createDirectory}
        validatePath={workspacePickerDataSource.validatePath}
        initialPath={defaultWorkingRoot || undefined}
      />
    </>
  );
}

function extractFolderName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
}

function nextWorkspaceName(folderName: string, existingNames: ReadonlySet<string>): string {
  let candidate = folderName;
  let suffix = 2;
  while (existingNames.has(candidate.trim().toLowerCase())) {
    candidate = `${folderName}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
