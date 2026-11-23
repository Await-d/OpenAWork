import { createRoot } from 'react-dom/client';
import { FileEditorPanel } from '../src/components/file-editor/editor/FileEditorPanel.js';
import { useAuthStore } from '../src/stores/auth/auth.js';
import '../src/index.css';

const workspacePath = '/workspace';
const file = {
  path: `${workspacePath}/reports/quarterly-review/2026/financial-report.txt`,
  name: 'financial-report.txt',
  language: 'plaintext',
  content: 'Unsaved draft',
  originalContent: 'Saved file',
};

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
useAuthStore.setState({ gatewayUrl: location.origin, accessToken: 'export-fixture' });
const root = document.getElementById('root');
if (!root) throw new Error('文件导出验收缺少根节点');
createRoot(root).render(
  <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <FileEditorPanel
      files={[file]}
      activeFile={file}
      activeFilePath={file.path}
      isDirty={() => true}
      onActivate={() => undefined}
      onClose={() => undefined}
      onChange={() => undefined}
      onSave={() => undefined}
      workspacePath={workspacePath}
    />
  </main>,
);
