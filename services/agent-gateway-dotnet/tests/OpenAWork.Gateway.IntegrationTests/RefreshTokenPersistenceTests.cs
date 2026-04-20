using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class RefreshTokenPersistenceTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public RefreshTokenPersistenceTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task RefreshTokens_ShouldPersist_ForExistingUser()
    {
        const string userId = "user-refresh-persist";

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

        dbContext.Users.Add(new UserRecord
        {
            Id = userId,
            Email = $"{userId}@openawork.local",
            PasswordHash = "seed",
            CreatedAtUtc = DateTimeOffset.UtcNow,
        });

        dbContext.RefreshTokens.Add(new RefreshTokenRecord
        {
            Id = "refresh-token-1",
            UserId = userId,
            TokenHash = "hash-1",
            ExpiresAtUtc = DateTimeOffset.UtcNow.AddDays(7),
        });

        await dbContext.SaveChangesAsync();

        var persisted = await dbContext.RefreshTokens.SingleAsync((token) => token.Id == "refresh-token-1");

        Assert.Equal(userId, persisted.UserId);
        Assert.Equal("hash-1", persisted.TokenHash);
    }

    [Fact]
    public async Task RefreshTokens_ShouldEnforceUniqueTokenHash()
    {
        const string userA = "user-refresh-unique-a";
        const string userB = "user-refresh-unique-b";

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

        dbContext.Users.AddRange(
            new UserRecord
            {
                Id = userA,
                Email = $"{userA}@openawork.local",
                PasswordHash = "seed",
                CreatedAtUtc = DateTimeOffset.UtcNow,
            },
            new UserRecord
            {
                Id = userB,
                Email = $"{userB}@openawork.local",
                PasswordHash = "seed",
                CreatedAtUtc = DateTimeOffset.UtcNow,
            });

        dbContext.RefreshTokens.Add(new RefreshTokenRecord
        {
            Id = "refresh-token-unique-1",
            UserId = userA,
            TokenHash = "shared-hash",
            ExpiresAtUtc = DateTimeOffset.UtcNow.AddDays(7),
        });

        await dbContext.SaveChangesAsync();

        dbContext.RefreshTokens.Add(new RefreshTokenRecord
        {
            Id = "refresh-token-unique-2",
            UserId = userB,
            TokenHash = "shared-hash",
            ExpiresAtUtc = DateTimeOffset.UtcNow.AddDays(7),
        });

        await Assert.ThrowsAsync<DbUpdateException>(async () => await dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task RefreshTokens_ShouldCascadeDelete_WhenUserIsDeleted()
    {
        const string userId = "user-refresh-cascade";

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

        var user = new UserRecord
        {
            Id = userId,
            Email = $"{userId}@openawork.local",
            PasswordHash = "seed",
            CreatedAtUtc = DateTimeOffset.UtcNow,
        };

        dbContext.Users.Add(user);
        dbContext.RefreshTokens.Add(new RefreshTokenRecord
        {
            Id = "refresh-token-cascade",
            UserId = userId,
            TokenHash = "hash-cascade",
            ExpiresAtUtc = DateTimeOffset.UtcNow.AddDays(7),
        });

        await dbContext.SaveChangesAsync();

        dbContext.Users.Remove(user);
        await dbContext.SaveChangesAsync();

        var remainingCount = await dbContext.RefreshTokens.CountAsync((token) => token.UserId == userId);
        Assert.Equal(0, remainingCount);
    }
}
