namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class UserRecord
{
    public required string Id { get; set; }

    public required string Email { get; set; }

    public required string PasswordHash { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }
}
