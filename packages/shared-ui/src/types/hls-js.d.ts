declare module 'hls.js' {
  export interface HlsConfig {
    enableWorker?: boolean;
    lowLatencyMode?: boolean;
    backBufferLength?: number;
  }

  export interface HlsErrorData {
    fatal: boolean;
    type: string;
  }

  export default class Hls {
    static isSupported(): boolean;
    static readonly Events: {
      readonly ERROR: string;
    };
    static readonly ErrorTypes: {
      readonly NETWORK_ERROR: string;
      readonly MEDIA_ERROR: string;
    };

    constructor(config?: HlsConfig);

    loadSource(src: string): void;
    attachMedia(media: HTMLMediaElement): void;
    on(event: string, listener: (event: string, data: HlsErrorData) => void): void;
    startLoad(): void;
    recoverMediaError(): void;
    destroy(): void;
  }
}
