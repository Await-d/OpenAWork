/**
 * jsdom 29.x 不附带类型声明，而 `@types/jsdom` 只发布了 28.0.3 / 30.0.0，
 * 均与 gateway 实际安装的 29.1.1 运行时版本不匹配。这里按仓库既有做法
 * （见 open-websearch-internals.d.ts）只声明 gateway 实际用到的极小面：
 * 构造 JSDOM 并读取 document，供 `@mozilla/readability` 消费。
 */
declare module 'jsdom' {
  export interface JSDOMOptions {
    readonly url?: string;
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: {
      readonly document: Document;
    };
  }
}
