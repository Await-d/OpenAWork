/**
 * Provider Plugins 入口
 *
 * 导入此文件会注册所有内置 provider 插件。
 * 在 gateway 启动时（路由注册之前）import 一次即可。
 */
import './anthropic.js';
import './openai.js';
import './deepseek.js';
import './gemini.js';
import './openrouter.js';
import './nvidia.js';
import './custom.js';
