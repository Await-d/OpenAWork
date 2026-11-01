import { create } from 'zustand';

/**
 * 「服务端已受理本轮运行」的瞬时信号，由流事件 `run_accepted` 置位。
 *
 * 客户端在发送瞬间渲染的「已收到」气泡只是乐观渲染；这一条才是服务端侧的凭据。
 * 复杂任务从受理到首个 token 可能长达数十秒，把「还在路上」与「已受理、正在准备」
 * 分开，用户才知道自己等的是哪一段。
 *
 * **为什么用 store 而不是 props**：信号产生在 `run-send-message` 的流事件回调里，
 * 消费方是消息流里的占位气泡；两者之间隔着 ChatPage → `useChatRenderData` →
 * `renderContent` 闭包 → MessageRow → ChatPageSections。为「换一句文案」付这条链路
 * 的代价不划算。
 *
 * **为什么可以只存最近一次而不按请求索引**：同一页面同一时刻只会有一个本端发起的
 * 活跃流（多端并发由网关单飞锁与消费租约隔开），并且每轮开始都由
 * `startStandardChatStream` 复位。因此消费者只需判断「有没有」，不必比较时间戳——
 * 浏览器与服务端的时钟偏差也不会影响判定。
 */
interface RunAcceptedState {
  /** 最近一次受理确认的时间戳；`null` 表示本轮尚未收到确认。 */
  acceptedAt: number | null;
  markAccepted: (acceptedAt: number) => void;
  reset: () => void;
}

export const useRunAcceptedStore = create<RunAcceptedState>((set) => ({
  acceptedAt: null,
  markAccepted: (acceptedAt) => set({ acceptedAt }),
  reset: () => set({ acceptedAt: null }),
}));
