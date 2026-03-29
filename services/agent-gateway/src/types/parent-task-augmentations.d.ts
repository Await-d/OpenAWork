declare module '@openAwork/agent-core' {
  interface AgentTask {
    parentTaskId?: string;
  }

  interface ToolCallResult {
    pendingPermissionRequestId?: string;
  }
}

declare module '@openAwork/shared' {
  interface StreamTaskUpdateChunk {
    parentTaskId?: string;
  }
}

export {};
