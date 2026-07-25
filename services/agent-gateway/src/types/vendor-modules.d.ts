declare module 'ffprobe-static' {
  const ffprobeStatic: {
    path: string;
  };

  export default ffprobeStatic;
}

declare module 'ws' {
  export interface WebSocketOptions {
    headers?: Record<string, string>;
  }

  export default class WebSocket {
    constructor(url: string, options?: WebSocketOptions);

    close(): void;
    on(event: 'open', listener: () => void): this;
    on(event: 'message', listener: (data: Buffer) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'close', listener: () => void): this;
    send(data: string): void;
    terminate(): void;
  }
}
