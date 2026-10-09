/**
 * 错误捕获安装入口（side-effect 模块）。
 *
 * 为什么要单独一个模块：ESM 的 `import` 声明会被提升并**先于**模块体的语句执行。
 * 若把 `installClientErrorCapture()` 写在 `main.tsx` 的模块体里，它必然晚于
 * `import App from './App.js'` 整棵依赖树的模块求值——那些模块顶层一旦抛错
 * （Monaco 初始化、Worker 探测、浏览器能力检测都是典型位置），捕获器还没装上，
 * 错误便直接静默丢失。
 *
 * ESM 保证 import 按书写顺序执行，因此把本模块放在 `main.tsx` 的**第一条 import**
 * 就能把安装时点提到应用依赖树之前。这是纯 ESM 下能拿到的最早时点。
 *
 * 仅做安装，不引入任何 UI / 业务依赖，保证求值成本接近零。
 */
import { installClientErrorCapture } from './error-capture.js';

installClientErrorCapture();
