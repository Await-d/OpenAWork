import {
  detectDevServerUrl,
  isLikelyDevServerCommand,
} from '../../../../components/conversation-runtime/attachments/dev-server-detect.js';

export interface TerminalStartedEventLike {
  type: 'terminal_started';
  command: string;
  terminalId: string;
}

export interface TerminalOutputEventLike {
  type: 'terminal_output';
  outputTail: string;
  terminalId: string;
}

export type TerminalDevServerEventLike = TerminalStartedEventLike | TerminalOutputEventLike;

export interface DetectTerminalDevServerOptions {
  detectedTerminalIds: Set<string>;
  event: TerminalDevServerEventLike;
}

export interface DetectTerminalDevServerResult {
  detectedUrl?: string;
  shouldMarkTerminalHandled: boolean;
}

export function detectTerminalDevServer(
  options: DetectTerminalDevServerOptions,
): DetectTerminalDevServerResult {
  const { detectedTerminalIds, event } = options;

  if (detectedTerminalIds.has(event.terminalId)) {
    return { shouldMarkTerminalHandled: false };
  }

  if (
    event.type === 'terminal_started' &&
    event.command &&
    !isLikelyDevServerCommand(event.command)
  ) {
    return { shouldMarkTerminalHandled: true };
  }

  if (event.type === 'terminal_output' && event.outputTail) {
    const detected = detectDevServerUrl(event.outputTail);
    if (detected) {
      return {
        detectedUrl: detected.url,
        shouldMarkTerminalHandled: true,
      };
    }
  }

  return { shouldMarkTerminalHandled: false };
}
