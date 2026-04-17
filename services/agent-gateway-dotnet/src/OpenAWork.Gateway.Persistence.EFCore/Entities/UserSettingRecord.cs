namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class UserSettingRecord
{
    public long Id { get; set; }

    public required string UserId { get; set; }

    public required string Key { get; set; }

    public required string Value { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public UserRecord? User { get; set; }
}
