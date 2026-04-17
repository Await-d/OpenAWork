namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record McpStatusResponse(IReadOnlyList<McpStatusServerItem> Servers);
