# 聊天界面媒体渲染 + AI 媒体转换工具

## Task Overview
为聊天界面添加音频、视频媒体渲染能力，同时在后端新增 AI 媒体转换工具（格式转换、元信息提取、视频帧提取、TTS 音频生成）。

## Current Analysis
- 图片已有完整渲染链路（上传预览→消息画廊→Lightbox）
- 音频仅输入侧语音转文字 + 附件标签，无消息内播放器
- 视频完全不支持
- 后端无媒体处理工具
- 消息 schema 缺少音频/视频内容块类型

## Solution Design
- 扩展消息类型：新增 `InputAudioContent` / `InputVideoContent`
- 后端：使用 `fluent-ffmpeg` + `ffmpeg-static` + `ffprobe-static` Node 原生绑定
- TTS：使用免费方案 Edge TTS（`edge-tts` npm 包），无需 API Key
- 前端：新增 AudioPlayer / VideoPlayer 组件 + 媒体渲染分发器
- 附件：扩展视频识别 + 音视频 dataUrl

## Complexity Assessment
- Atomic steps: 23 → +2
- Parallel streams: 是（后端/前端可并行）→ +2
- Modules/systems/services: 5+（shared, agent-core, gateway, web, shared-ui）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- **Total score**: 7
- **Chosen mode**: Full orchestration
- **Routing rationale**: 涉及 5+ 模块多层架构，需要并行执行以控制总时间

## Implementation Plan

### Phase 1: 类型层基础（shared + agent-core + shared-ui）
- [x] T-01: `message-schema.ts` 新增 `InputAudioContent` / `InputVideoContent` 类型
- [x] T-02: `multimodal/index.ts` 扩展 `AttachmentType` 增加 `'video'`
- [x] T-03: `provider/types.ts` 新增音频/视频能力声明字段
- [x] T-04: `shared-ui/chat/AttachmentBar.tsx` 扩展 `AttachmentItem` 类型
- [x] T-05: `shared/src/index.ts` 导出新类型

### Phase 2: 后端媒体处理基础设施（gateway）
- [x] T-06: 安装 `fluent-ffmpeg` + `ffmpeg-static` + `ffprobe-static` 依赖
- [x] T-07: `media/ffmpeg-bridge.ts` — FFmpeg 封装
- [x] T-08: `media/ffprobe-bridge.ts` — 元信息提取
- [x] T-09: `media/media-codec.ts` — 编码器映射
- [x] T-10: `media/media-artifact.ts` — 媒体 artifact 管理

### Phase 3: 后端 AI 工具（gateway）
- [x] T-11: `tools/convert-media-tool.ts` — 媒体格式转换
- [x] T-12: `tools/extract-media-info-tool.ts` — 媒体元信息提取
- [x] T-13: `tools/extract-video-frame-tool.ts` — 视频帧提取
- [x] T-14: `tools/generate-audio-tool.ts` — Edge TTS 音频生成
- [x] T-15: `tools/tool-definitions.ts` 注册新工具
- [x] T-16: `tools/tool-sandbox.ts` 接入新工具执行

### Phase 4: 前端渲染组件（shared-ui + web）
- [x] T-17: `shared-ui/chat/AudioPlayer.tsx` — 音频播放器
- [x] T-18: `shared-ui/chat/VideoPlayer.tsx` — 视频播放器
- [x] T-19: `web/components/chat/media/media-renderer.tsx` — 媒体渲染分发器
- [x] T-20: `web/components/chat/media/audio-content-block.tsx`
- [x] T-21: `web/components/chat/media/video-content-block.tsx`
- [x] T-22: 工具调用卡片组件
- [x] T-23: `shared-ui/chat/index.ts` 导出新组件

### Phase 5: 集成与附件上传（web）
- [x] T-24: `attachment-upload.ts` 支持视频识别 + 音视频 dataUrl
- [x] T-25: 消息渲染流程接入 `media-renderer`
- [x] T-26: `extractInputAudio` / `extractInputVideo` 提取函数
- [x] T-27: Composer 音视频附件预览

## Notes
- FFmpeg 使用 Node 原生绑定（`ffmpeg-static` 预编译二进制）
- TTS 使用 Edge TTS 免费方案，无需 API Key
- 移动端（Expo）后续适配，本次仅 Web 端
