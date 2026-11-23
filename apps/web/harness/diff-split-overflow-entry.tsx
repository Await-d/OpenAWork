import { createRoot } from 'react-dom/client';
import { UnifiedCodeDiff } from '@openAwork/shared-ui';
import '../src/index.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = 'dark';

const LONG_LINE =
  "const result = await import('./a-very-long-module-name-that-keeps-going-and-going/and-another-segment/index.js');";

const beforeText = ['line 1', LONG_LINE, 'line 3', 'const tail = 1;'].join('\n');
const afterText = ['line 1', `${LONG_LINE} // changed`, 'line 3', 'const tail = 2;'].join('\n');

function Harness() {
  return (
    <div style={{ padding: 16, maxWidth: '100%', overflowX: 'hidden' }}>
      <h1 style={{ fontSize: 14 }}>双栏 diff 窄屏重叠验证</h1>
      <UnifiedCodeDiff
        beforeText={beforeText}
        afterText={afterText}
        filePath="apps/web/src/example.ts"
        viewMode="split"
        maxHeight={400}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('diff split harness 缺少 root');
createRoot(root).render(<Harness />);
