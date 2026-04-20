namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface IInstalledSkillReader
{
    Task<IReadOnlyList<InstalledSkillManifestEntry>> ListEnabledManifestsAsync(string userId, CancellationToken cancellationToken);
}

public sealed record InstalledSkillManifestEntry(
    string SkillId,
    string ManifestJson);
