export type BrowserPermissionLevel = 'once' | 'session' | 'permanent' | 'deny';

export interface TrustedDomain {
  hostname: string;
  level: BrowserPermissionLevel;
  addedAt: number;
}

export interface BrowserPermissionManager {
  check(url: string): BrowserPermissionLevel;
  trust(hostname: string, level: BrowserPermissionLevel): void;
  revoke(hostname: string): void;
  listTrusted(): TrustedDomain[];
}

export class BrowserPermissionManagerImpl implements BrowserPermissionManager {
  private readonly trusted = new Map<string, TrustedDomain>();

  check(url: string): BrowserPermissionLevel {
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      return 'deny';
    }

    const trustedDomain = this.trusted.get(hostname);
    if (!trustedDomain) {
      return 'once';
    }
    return trustedDomain.level;
  }

  trust(hostname: string, level: BrowserPermissionLevel): void {
    this.trusted.set(hostname, {
      hostname,
      level,
      addedAt: Date.now(),
    });
  }

  revoke(hostname: string): void {
    this.trusted.delete(hostname);
  }

  listTrusted(): TrustedDomain[] {
    return [...this.trusted.values()];
  }
}

export interface ScreenshotFeedback {
  sessionId: string;
  url: string;
  screenshotBase64: string;
  capturedAt: number;
  llmDescription?: string;
}

export type BrowserAction = 'navigate' | 'click' | 'type' | 'scroll' | 'screenshot' | 'evaluate';

export interface BrowserActionResult {
  action: BrowserAction;
  success: boolean;
  output?: unknown;
  screenshotBase64?: string;
  error?: string;
  durationMs: number;
}

export interface BrowserAutomationTool {
  navigate(url: string, sessionId: string): Promise<BrowserActionResult>;
  click(selector: string, sessionId: string): Promise<BrowserActionResult>;
  typeText(selector: string, text: string, sessionId: string): Promise<BrowserActionResult>;
  screenshot(sessionId: string): Promise<BrowserActionResult>;
  evaluate(script: string, sessionId: string): Promise<BrowserActionResult>;
  captureScreenshotFeedback(sessionId: string, url: string): Promise<ScreenshotFeedback>;
}

export class BrowserAutomationToolImpl implements BrowserAutomationTool {
  async navigate(url: string, sessionId: string): Promise<BrowserActionResult> {
    const startedAt = Date.now();
    return {
      action: 'navigate',
      success: true,
      output: { url, sessionId },
      durationMs: Date.now() - startedAt,
    };
  }

  async click(selector: string, sessionId: string): Promise<BrowserActionResult> {
    const startedAt = Date.now();
    return {
      action: 'click',
      success: true,
      output: { selector, sessionId },
      durationMs: Date.now() - startedAt,
    };
  }

  async typeText(selector: string, text: string, sessionId: string): Promise<BrowserActionResult> {
    const startedAt = Date.now();
    return {
      action: 'type',
      success: true,
      output: { selector, text, sessionId },
      durationMs: Date.now() - startedAt,
    };
  }

  async screenshot(sessionId: string): Promise<BrowserActionResult> {
    const startedAt = Date.now();
    return {
      action: 'screenshot',
      success: true,
      screenshotBase64: '',
      output: { sessionId },
      durationMs: Date.now() - startedAt,
    };
  }

  async evaluate(script: string, sessionId: string): Promise<BrowserActionResult> {
    const startedAt = Date.now();
    return {
      action: 'evaluate',
      success: true,
      output: { script, sessionId },
      durationMs: Date.now() - startedAt,
    };
  }

  async captureScreenshotFeedback(sessionId: string, url: string): Promise<ScreenshotFeedback> {
    return {
      sessionId,
      url,
      screenshotBase64: '',
      capturedAt: Date.now(),
    };
  }
}
