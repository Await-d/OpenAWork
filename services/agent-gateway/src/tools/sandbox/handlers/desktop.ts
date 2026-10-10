/**
 * 桌面自动化域 handler(261009-tool-sandbox 拆分 P2 / T-08)。
 *
 * desktop_automation / desktop_control / computer_use 三个分支体逐字搬出。
 * 注意:插件开关的用户级校验已在 `ToolSandbox.executeToolCall` 前置完成,
 * 本模块只保留原分支内的执行期校验,语义不变。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import {
  desktopAutomationManager,
  desktopAutomationToolDefinition,
  runDesktopAutomationTool,
} from '../../desktop-automation.js';
import {
  desktopControlManager,
  desktopControlToolDefinition,
  runDesktopControlTool,
} from '../../desktop-control.js';
import {
  createDesktopScreenshotArtifactToolResult,
  readDesktopControlScreenshotPayload,
} from '../../desktop-screenshot-artifact.js';
import {
  computerUseToolDefinition,
  runComputerUseToolWithScreenshot,
} from '../../gui/computer-use-tool.js';
import type { SandboxHandlerContext } from '../context.js';
import { getSessionOwnerUserId } from '../session-context.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleDesktopAutomationTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
  const parsed = desktopAutomationToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  if (parsed.data.action === 'screenshot') {
    const userId = getSessionOwnerUserId(sessionId);
    if (!userId) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: `Session owner not found for session ${sessionId}`,
        isError: true,
        durationMs: 0,
      };
    }

    const screenshotResult = createDesktopScreenshotArtifactToolResult({
      userId,
      sessionId,
      toolCallId: request.toolCallId,
      screenshotPayload: await desktopAutomationManager.screenshot(),
      title: 'Desktop automation screenshot',
      summary: '已保存桌面自动化截图，完整图像已作为图片附件提供。',
      sourceKind: 'tool_desktop_automation_screenshot',
      createdByNote: 'desktop_automation screenshot',
    });
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: screenshotResult.output,
      attachments: screenshotResult.attachments,
      isError: false,
      durationMs: 0,
    };
  }

  // 运行环境层（`DESKTOP_AUTOMATION=1`）关闭时，manager 的 `assertEnabled()`
  // 会抛错；此处必须捕获并以结构化工具错误返回，否则异常会穿透沙箱分派
  // 打断整个工具回合（与 computer_use 分支的处理保持一致）。
  try {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      // 传入 (sessionId, toolCallId) 后,content 超限会把整页 HTML 源头裁剪为
      // 预览并落盘,模型可用 read_tool_output 按 toolCallId 取回全文。
      output: await runDesktopAutomationTool(parsed.data, desktopAutomationManager, {
        sessionId,
        toolCallId: request.toolCallId,
      }),
      isError: false,
      durationMs: 0,
    };
  } catch (error) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
      durationMs: 0,
    };
  }
}

export async function handleDesktopControlTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
  const parsed = desktopControlToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  if (parsed.data.action === 'screenshot') {
    const userId = getSessionOwnerUserId(sessionId);
    if (!userId) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: `Session owner not found for session ${sessionId}`,
        isError: true,
        durationMs: 0,
      };
    }

    const screenshotPayload = readDesktopControlScreenshotPayload(
      await desktopControlManager.screenshot(parsed.data),
    );
    if (!screenshotPayload) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: '系统桌面截图结果缺少可用的图像数据。',
        isError: true,
        durationMs: 0,
      };
    }

    const screenshotResult = createDesktopScreenshotArtifactToolResult({
      userId,
      sessionId,
      toolCallId: request.toolCallId,
      screenshotPayload,
      title: 'Desktop control screenshot',
      summary: '已保存系统桌面截图，完整图像已作为图片附件提供。',
      sourceKind: 'tool_desktop_control_screenshot',
      createdByNote: 'desktop_control screenshot',
    });
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: screenshotResult.output,
      attachments: screenshotResult.attachments,
      isError: false,
      durationMs: 0,
    };
  }

  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: await runDesktopControlTool(parsed.data),
    isError: false,
    durationMs: 0,
  };
}

export async function handleComputerUseTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }
  const parsed = computerUseToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }
  try {
    const computerUseResult = await runComputerUseToolWithScreenshot(parsed.data, {
      userId,
      sessionId,
      toolCallId: request.toolCallId,
      signal,
    });
    // G3：把最后一张截图转成 artifact，并以 attachments 回传（与 desktop_control 截图同范式）。
    const screenshot = computerUseResult.screenshot;
    if (screenshot) {
      try {
        const artifactResult = createDesktopScreenshotArtifactToolResult({
          userId,
          sessionId,
          toolCallId: request.toolCallId,
          screenshotPayload: screenshot.dataBase64.startsWith('data:')
            ? screenshot.dataBase64
            : `data:${screenshot.mediaType};base64,${screenshot.dataBase64}`,
          title: 'Computer use final screenshot',
          summary: 'GUI 任务结束时的屏幕画面已作为图片附件提供。',
          sourceKind: 'tool_desktop_control_screenshot',
          createdByNote: 'computer_use final screenshot',
        });
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: computerUseResult.output,
          attachments: artifactResult.attachments,
          isError: false,
          durationMs: 0,
        };
      } catch {
        // artifact 生成失败不应让整个 GUI 任务算失败——降级为纯文本结果。
      }
    }
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: computerUseResult.output,
      isError: false,
      durationMs: 0,
    };
  } catch (error) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
      durationMs: 0,
    };
  }
}
