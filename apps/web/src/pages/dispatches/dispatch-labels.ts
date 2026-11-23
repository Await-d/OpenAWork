import type { DispatchRole, DispatchStatus } from '@openAwork/shared';

export const statusLabels: Record<DispatchStatus, string> = {
  draft: '待确认',
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
  cancelled: '已取消',
  partial: '部分完成',
};

export const roleLabels: Record<DispatchRole, string> = {
  summarize: '总结',
  extract: '提取',
  review: '审阅',
};

export const modelDisclosure =
  '使用账户的聊天模型。生成草稿时，派工目标会发送给模型；草稿生成成功后，粘贴的文本会保存在网关。确认后，执行时才会将粘贴的文本发送给模型，追问也会发送给模型。如果模型由外部提供方托管，发送给模型的内容会交给该提供方。请勿提交敏感信息。';
