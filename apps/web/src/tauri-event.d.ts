declare module '@tauri-apps/api/event' {
  export interface TauriEvent<T> {
    event: string;
    id: number;
    payload: T;
  }

  export type UnlistenFn = () => void;

  export function listen<T>(
    event: string,
    handler: (event: TauriEvent<T>) => void,
  ): Promise<UnlistenFn>;

  export function emit<T>(event: string, payload?: T): Promise<void>;
}
