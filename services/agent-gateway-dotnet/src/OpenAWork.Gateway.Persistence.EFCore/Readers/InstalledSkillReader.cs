using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Persistence;

namespace OpenAWork.Gateway.Persistence.EFCore.Readers;

public sealed class InstalledSkillReader(GatewayDbContext dbContext) : IInstalledSkillReader
{
    public Task<IReadOnlyList<InstalledSkillManifestEntry>> ListEnabledManifestsAsync(string userId, CancellationToken cancellationToken)
    {
        return dbContext.InstalledSkills
            .AsNoTracking()
            .Where((skill) => skill.UserId == userId && skill.Enabled)
            .OrderBy((skill) => skill.SkillId)
            .Select((skill) => new InstalledSkillManifestEntry(skill.SkillId, skill.ManifestJson))
            .ToListAsync(cancellationToken)
            .ContinueWith((task) => (IReadOnlyList<InstalledSkillManifestEntry>)task.Result, cancellationToken);
    }
}
