namespace OpenAWork.Gateway.Application.Abstractions.Streaming;

public interface ISessionStreamRuntimeService
{
    Task<int> HandleAsync(SessionStreamRuntimeRequest request, Func<object, ValueTask> writeChunk, CancellationToken connectionCancellationToken);
}

public sealed record SessionStreamInitialToolResult(
    string ToolCallId,
    string ToolName,
    string RawInputJson,
    string OutputJson,
    bool IsError,
    bool ResumedAfterApproval,
    int? NextRound,
    string? Reason);

public sealed record SessionStreamRuntimeRequest(
    string SessionId,
    string UserId,
    string ClientRequestId,
    string Message,
    string? DisplayMessage,
    string? AgentId,
    string? ProviderId,
    string? Model,
    bool? ThinkingEnabled,
    bool? WebSearchEnabled,
    SessionStreamInitialToolResult? InitialToolResult);
