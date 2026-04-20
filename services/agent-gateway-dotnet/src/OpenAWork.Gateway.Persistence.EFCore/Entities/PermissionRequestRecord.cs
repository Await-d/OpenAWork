namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class PermissionRequestRecord
{
    public required string Id { get; set; }

    public required string SessionId { get; set; }

    public required string ToolName { get; set; }

    public required string Scope { get; set; }

    public required string Reason { get; set; }

    public required string RiskLevel { get; set; }

    public string? PreviewAction { get; set; }

    public required string Status { get; set; }

    public string? Decision { get; set; }

    public string? RequestPayloadJson { get; set; }

    public long? ExpiresAtMs { get; set; }

    public string? AlwaysJson { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public SessionRecord? Session { get; set; }
}
