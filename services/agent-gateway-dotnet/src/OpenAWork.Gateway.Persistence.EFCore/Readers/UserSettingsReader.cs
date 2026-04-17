using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Persistence;

namespace OpenAWork.Gateway.Persistence.EFCore.Readers;

public sealed class UserSettingsReader(GatewayDbContext dbContext) : IUserSettingsReader
{
    public Task<string?> GetValueAsync(string userId, string key, CancellationToken cancellationToken)
    {
        return dbContext.UserSettings
            .AsNoTracking()
            .Where((setting) => setting.UserId == userId && setting.Key == key)
            .Select((setting) => setting.Value)
            .FirstOrDefaultAsync(cancellationToken);
    }
}
