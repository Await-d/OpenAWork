namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class RefreshTokenRecord
{
    public required string Id { get; set; }

    public required string UserId { get; set; }

    public required string TokenHash { get; set; }

    public DateTimeOffset ExpiresAtUtc { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public UserRecord? User { get; set; }
}
