import { create } from 'zustand';

interface UpdatePanelState {
  /** 是否显示更新弹窗 */
  showUpdateDialog: boolean;
  /** 是否自动开始检查 */
  updateAutoStart: boolean;
  /** 打开更新面板 */
  openUpdatePanel: (autoStart?: boolean) => void;
  /** 关闭更新面板 */
  closeUpdatePanel: () => void;
}

export const useUpdatePanelStore = create<UpdatePanelState>((set) => ({
  showUpdateDialog: false,
  updateAutoStart: false,
  openUpdatePanel: (autoStart = true) => {
    console.log('[updatePanelStore] openUpdatePanel called, autoStart:', autoStart);
    set({ showUpdateDialog: true, updateAutoStart: autoStart });
  },
  closeUpdatePanel: () => {
    set({ showUpdateDialog: false, updateAutoStart: false });
  },
}));
