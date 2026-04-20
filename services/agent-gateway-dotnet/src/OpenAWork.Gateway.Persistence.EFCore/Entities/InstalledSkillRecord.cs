namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class InstalledSkillRecord
{
    public required string SkillId { get; set; }

    public required string UserId { get; set; }

    public required string SourceId { get; set; }

    public required string ManifestJson { get; set; }

    public required string GrantedPermissionsJson { get; set; }

    public bool Enabled { get; set; }

    public long InstalledAt { get; set; }

    public long UpdatedAt { get; set; }

    public UserRecord? User { get; set; }
}
