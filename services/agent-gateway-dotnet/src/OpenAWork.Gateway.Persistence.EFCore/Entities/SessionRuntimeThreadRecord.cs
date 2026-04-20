namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class SessionRuntimeThreadRecord
{
    public required string SessionId { get; set; }

    public required string UserId { get; set; }

    public required string ClientRequestId { get; set; }

    public long StartedAtMs { get; set; }

    public long HeartbeatAtMs { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public SessionRecord? Session { get; set; }

    public UserRecord? User { get; set; }
}
