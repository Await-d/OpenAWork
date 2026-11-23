import { createRoot } from 'react-dom/client';
import { UnifiedCodeDiff } from '@openAwork/shared-ui';
// 生产入口（main.tsx）先加载 layout-tokens 再加载 index.css；harness 必须一致，
// 否则 --spacing-* / --radius-* 全部未定义，间距类断言与视觉效果都会失真。
import '../src/styles/layout-tokens.css';
import '../src/index.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';

/** 构造 1200 行文件，只在第 800 行改一处 —— 模拟「大文件小改动」。 */
function makeLargeFile(): { before: string; after: string } {
  const lines = Array.from(
    { length: 1200 },
    (_, index) => `const value${index + 1} = ${index + 1};`,
  );
  const before = lines.join('\n');
  const after = [...lines];
  after[799] = 'const value800 = CHANGED;';
  return { before, after: after.join('\n') };
}

/** 小文件对照：改动一眼可见，不应被折叠。 */
function makeSmallFile(): { before: string; after: string } {
  const lines = Array.from({ length: 8 }, (_, index) => `const small${index + 1} = ${index + 1};`);
  const before = lines.join('\n');
  const after = [...lines];
  after[3] = 'const small4 = CHANGED;';
  return { before, after: after.join('\n') };
}

const large = makeLargeFile();
const small = makeSmallFile();

function Harness() {
  return (
    <main className="collapse-harness">
      <h1>大文件差异折叠验证</h1>

      <section data-case="large">
        <h2>1200 行文件 · 仅第 800 行改动（应折叠，且变更可见）</h2>
        <UnifiedCodeDiff
          beforeText={large.before}
          afterText={large.after}
          filePath="apps/web/src/large-example.ts"
          viewMode="unified"
          maxHeight={400}
        />
      </section>

      <section data-case="large-split">
        <h2>同上 · 双栏布局</h2>
        <UnifiedCodeDiff
          beforeText={large.before}
          afterText={large.after}
          filePath="apps/web/src/large-example.ts"
          viewMode="split"
          maxHeight={400}
        />
      </section>

      <section data-case="small">
        <h2>8 行小文件（不应折叠）</h2>
        <UnifiedCodeDiff
          beforeText={small.before}
          afterText={small.after}
          filePath="apps/web/src/small-example.ts"
          viewMode="unified"
          maxHeight={300}
        />
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('collapse harness 缺少 root');
createRoot(root).render(<Harness />);
