namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record McpStatusServerItem(
    string Id,
    string Name,
    string Type,
    string Status,
    bool Enabled);
