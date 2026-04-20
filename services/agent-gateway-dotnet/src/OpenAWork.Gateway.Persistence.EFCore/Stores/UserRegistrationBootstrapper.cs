using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class UserRegistrationBootstrapper(GatewayDbContext dbContext) : IUserRegistrationBootstrapper
{
    public async Task EnsureDefaultsForUserAsync(string userId, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var nowMilliseconds = now.ToUnixTimeMilliseconds();

        foreach (var skill in DefaultUserSeedData.InstalledSkills)
        {
            var existingSkill = await dbContext.InstalledSkills.SingleOrDefaultAsync(
                (record) => record.SkillId == skill.SkillId && record.UserId == userId,
                cancellationToken);

            if (existingSkill is null)
            {
                dbContext.InstalledSkills.Add(new InstalledSkillRecord
                {
                    SkillId = skill.SkillId,
                    UserId = userId,
                    SourceId = skill.SourceId,
                    ManifestJson = DefaultUserSeedData.SerializeManifest(skill),
                    GrantedPermissionsJson = "[]",
                    Enabled = true,
                    InstalledAt = nowMilliseconds,
                    UpdatedAt = nowMilliseconds,
                });
            }
            else
            {
                existingSkill.SourceId = skill.SourceId;
                existingSkill.ManifestJson = DefaultUserSeedData.SerializeManifest(skill);
                existingSkill.GrantedPermissionsJson = "[]";
                existingSkill.Enabled = true;
                existingSkill.UpdatedAt = nowMilliseconds;
            }
        }

        var existingTemplates = await dbContext.WorkflowTemplates
            .Where((template) => template.UserId == userId)
            .ToListAsync(cancellationToken);

        var templatesBySeedKey = new Dictionary<string, WorkflowTemplateRecord>(StringComparer.Ordinal);
        foreach (var template in existingTemplates)
        {
            var seedKey = DefaultUserSeedData.ParseSeedKey(template.MetadataJson);
            if (!string.IsNullOrWhiteSpace(seedKey))
            {
                templatesBySeedKey[seedKey] = template;
            }
        }

        foreach (var seed in DefaultUserSeedData.WorkflowTemplates)
        {
            if (templatesBySeedKey.TryGetValue(seed.SeedKey, out var existingTemplate))
            {
                existingTemplate.Name = seed.Name;
                existingTemplate.Description = seed.Description;
                existingTemplate.Category = seed.Category;
                existingTemplate.MetadataJson = DefaultUserSeedData.SerializeWorkflowMetadata(seed);
                existingTemplate.NodesJson = DefaultUserSeedData.SerializeWorkflowNodes(seed);
                existingTemplate.EdgesJson = DefaultUserSeedData.SerializeWorkflowEdges();
                existingTemplate.UpdatedAtUtc = now;
                continue;
            }

            dbContext.WorkflowTemplates.Add(new WorkflowTemplateRecord
            {
                Id = Guid.NewGuid().ToString(),
                UserId = userId,
                Name = seed.Name,
                Description = seed.Description,
                Category = seed.Category,
                MetadataJson = DefaultUserSeedData.SerializeWorkflowMetadata(seed),
                NodesJson = DefaultUserSeedData.SerializeWorkflowNodes(seed),
                EdgesJson = DefaultUserSeedData.SerializeWorkflowEdges(),
                CreatedAtUtc = now,
                UpdatedAtUtc = now,
            });
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task EnsureDefaultsForAllUsersAsync(CancellationToken cancellationToken)
    {
        var userIds = await dbContext.Users.AsNoTracking().Select((user) => user.Id).ToListAsync(cancellationToken);
        foreach (var userId in userIds)
        {
            await EnsureDefaultsForUserAsync(userId, cancellationToken);
        }
    }
}
