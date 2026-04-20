namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record DevLogsResponse(IReadOnlyList<DevLogItemResponse> Logs);
