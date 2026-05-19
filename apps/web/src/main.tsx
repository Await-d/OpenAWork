import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.js';
import './index.css';
import './styles/loaders.css';
import './styles/ui-hovers.css';
import { installMonacoAsyncErrorFilter } from './components/file-editor/editor/MonacoErrorBoundary.js';
import { installExtensionNoiseFilter } from './lib/filter/extension-noise-filter.js';
import { installMonacoI18n } from './lib/monaco/monaco-i18n.js';

// Configure Monaco to load from local bundle instead of CDN.
// This prevents "Monaco initialization: error" when the CDN is unreachable.
import './lib/monaco/monaco-loader.js';

// Translate Monaco's right-click menu (and related overlays) to
// Chinese. Calling here in addition to monaco-loader so the install
// doesn't depend on Monaco's own module evaluation succeeding first.
installMonacoI18n();

// Suppress noisy errors thrown by browser extensions (Tampermonkey,
// ad-blockers, ...) injecting scripts into our sandboxed preview
// iframes. These can't be fixed in our code and only clutter the
// console. See lib/extension-noise-filter.ts.
installExtensionNoiseFilter();

// Suppress noisy Monaco post-dispose async errors that fire from the
// editor's own setTimeout / rAF callbacks. They are benign in dev (only
// happen because StrictMode double-invokes effects) but clutter the
// console and mask real errors. See MonacoErrorBoundary for the React
// render-time half of the story.
installMonacoAsyncErrorFilter();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// NOTE: We deliberately do NOT wrap the tree in `<StrictMode>`.
//
// React 19's StrictMode double-invokes mount/cleanup/mount on every
// component, which collides with `@monaco-editor/react@4.7`'s lifecycle:
// the first cleanup disposes the InstantiationService and the second
// mount tries to reuse it, throwing
//   "InstantiationService has been disposed"
// or
//   "Cannot read properties of undefined (reading 'domNode')"
// every time the user opens a file or switches editor tabs.
//
// `@xterm/xterm` exhibits a similar pattern (matchMedia / canvas
// teardown). Both libraries are mature and used widely in non-React
// editors; chasing every dispose path inside our wrapper components
// trades a lot of complexity for an audit feature whose only customer
// is dev-mode warnings.
//
// Production has never had StrictMode, so app behaviour is unchanged.
// If we want the safety pass back later, the path forward is to swap
// to a Monaco wrapper that's React-19-strict-aware (or write our own
// thin one) and re-enable StrictMode at that point.
createRoot(root).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
