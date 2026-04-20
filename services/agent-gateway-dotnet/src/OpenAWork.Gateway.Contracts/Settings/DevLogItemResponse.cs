using System.Text.Json;

namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record DevLogItemResponse(
    string Id,
    string? SessionId,
    string RequestId,
    string Level,
    string Message,
    string ToolName,
    int? DurationMs,
    string CreatedAt,
    JsonElement? Input,
    JsonElement? Output,
    bool IsError,
    string Source);
