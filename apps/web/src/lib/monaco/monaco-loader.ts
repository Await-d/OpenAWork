/**
 * Configure @monaco-editor/react to load Monaco from the local
 * node_modules bundle (via Vite) instead of the default CDN (jsdelivr).
 *
 * This avoids "Monaco initialization: error" failures when the CDN is
 * unreachable (e.g. behind a firewall, in China, or offline).
 *
 * Also wires up Monaco's web workers via Vite's `?worker` import
 * syntax so that language services run off the main thread (otherwise
 * Monaco logs a warning and falls back to running them inline, which
 * can freeze the UI on large files).
 *
 * Must be called once at app startup, before any <Editor> mounts.
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Monaco reads this off `self.MonacoEnvironment` to spin up workers.
// See https://github.com/microsoft/monaco-editor#faq
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

loader.config({ monaco });
