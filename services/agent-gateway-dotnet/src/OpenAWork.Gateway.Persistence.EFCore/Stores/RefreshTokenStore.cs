using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class RefreshTokenStore(GatewayDbContext dbContext) : IRefreshTokenStore
{
    public Task AddAsync(string userId, string tokenHash, DateTimeOffset expiresAtUtc, CancellationToken cancellationToken)
    {
        dbContext.RefreshTokens.Add(new RefreshTokenRecord
        {
            Id = Guid.NewGuid().ToString(),
            UserId = userId,
            TokenHash = tokenHash,
            ExpiresAtUtc = expiresAtUtc,
        });

        return Task.CompletedTask;
    }

    public Task<RefreshTokenEntry?> FindValidByHashAsync(string tokenHash, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        return FindValidByHashCoreAsync(tokenHash, nowUtc, cancellationToken);
    }

    private async Task<RefreshTokenEntry?> FindValidByHashCoreAsync(string tokenHash, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        var token = await dbContext.RefreshTokens
            .AsNoTracking()
            .Where((record) => record.TokenHash == tokenHash)
            .Select((record) => new RefreshTokenEntry(record.Id, record.UserId, record.TokenHash, record.ExpiresAtUtc))
            .SingleOrDefaultAsync(cancellationToken);

        return token is not null && token.ExpiresAtUtc > nowUtc
            ? token
            : null;
    }

    public Task<int> DeleteByHashAsync(string tokenHash, CancellationToken cancellationToken)
    {
        return dbContext.RefreshTokens.Where((token) => token.TokenHash == tokenHash).ExecuteDeleteAsync(cancellationToken);
    }

    public Task<int> DeleteByUserIdAsync(string userId, CancellationToken cancellationToken)
    {
        return dbContext.RefreshTokens.Where((token) => token.UserId == userId).ExecuteDeleteAsync(cancellationToken);
    }
}
