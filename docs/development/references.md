# 跨平台 AI 客户端实施参考（官方/高可信）

## Expo / React Native

- Create a project（项目初始化与环境基线）  
  https://docs.expo.dev/get-started/create-a-project/
- Development Builds introduction（Expo Go 与开发构建差异）  
  https://docs.expo.dev/develop/development-builds/introduction/
- EAS Build introduction（构建与签名）  
  https://docs.expo.dev/build/introduction/
- EAS Workflows get started（CI 工作流）  
  https://docs.expo.dev/eas/workflows/get-started/
- EAS env variables FAQ（环境变量与密钥策略）  
  https://docs.expo.dev/eas/environment-variables/faq/
- SecureStore（安全存储能力与边界）  
  https://docs.expo.dev/versions/latest/sdk/securestore/
- React Native testing overview（分层测试策略）  
  https://reactnative.dev/docs/testing-overview

## Tauri

- GitHub Pipeline（发布流水线）  
  https://github.com/tauri-apps/tauri-docs/blob/4fa3ab52d5b613b18512c86f0305b6683d93eb57/src/content/docs/distribute/Pipelines/github.mdx
- macOS 签名（签名与证书流程）  
  https://github.com/tauri-apps/tauri-docs/blob/4fa3ab52d5b613b18512c86f0305b6683d93eb57/src/content/docs/distribute/Sign/macos.mdx
- Windows 签名（签名与 SmartScreen 注意事项）  
  https://github.com/tauri-apps/tauri-docs/blob/4fa3ab52d5b613b18512c86f0305b6683d93eb57/src/content/docs/distribute/Sign/windows.mdx
- Updater（更新签名、密钥托管）  
  https://github.com/tauri-apps/tauri-docs/blob/4fa3ab52d5b613b18512c86f0305b6683d93eb57/src/content/docs/plugin/updater.mdx
- tauri-action 发布示例（GitHub Actions）  
  https://github.com/tauri-apps/tauri-action/blob/0e08dcfb464bb2b08e3ed3ad0601106051bc610e/examples/publish-to-auto-release.yml

## WebSocket / 连接稳定性

- ws README（浏览器/Node 边界）  
  https://github.com/websockets/ws/blob/d3503c1fd36a310985108f62b343bae18346ab67/README.md#L13-L19
- ws README（心跳、断连检测）  
  https://github.com/websockets/ws/blob/d3503c1fd36a310985108f62b343bae18346ab67/README.md#L452-L520
- ws README（压缩开销与风险）  
  https://github.com/websockets/ws/blob/d3503c1fd36a310985108f62b343bae18346ab67/README.md#L98-L113
- Tauri websocket plugin（桌面侧可选实现）  
  https://github.com/tauri-apps/plugins-workspace/blob/024ec0c29c20cf94579dab9b79d6be0da61a8daa/plugins/websocket/README.md

## 客户端密钥与安全存储

- Tauri Stronghold plugin（桌面侧高价值密钥存储）  
  https://github.com/tauri-apps/plugins-workspace/blob/024ec0c29c20cf94579dab9b79d6be0da61a8daa/plugins/stronghold/README.md
