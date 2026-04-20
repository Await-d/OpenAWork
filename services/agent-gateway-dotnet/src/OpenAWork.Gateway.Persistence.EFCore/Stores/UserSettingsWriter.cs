using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class UserSettingsWriter(GatewayDbContext dbContext) : IUserSettingsWriter
{
    public async Task UpsertAsync(string userId, string key, string value, CancellationToken cancellationToken)
    {
        var existing = await dbContext.UserSettings.SingleOrDefaultAsync(
            (setting) => setting.UserId == userId && setting.Key == key,
            cancellationToken);

        if (existing is null)
        {
            dbContext.UserSettings.Add(new UserSettingRecord
            {
                UserId = userId,
                Key = key,
                Value = value,
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            return;
        }

        existing.Value = value;
        existing.UpdatedAtUtc = DateTimeOffset.UtcNow;
    }
}
