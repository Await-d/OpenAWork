using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class UserAuthStore(GatewayDbContext dbContext) : IUserAuthStore
{
    public Task<AuthUser?> FindByEmailAsync(string email, CancellationToken cancellationToken)
    {
        return dbContext.Users
            .AsNoTracking()
            .Where((user) => user.Email == email)
            .Select((user) => new AuthUser(user.Id, user.Email, user.PasswordHash))
            .SingleOrDefaultAsync(cancellationToken);
    }

    public Task<AuthUser?> FindByIdAsync(string userId, CancellationToken cancellationToken)
    {
        return dbContext.Users
            .AsNoTracking()
            .Where((user) => user.Id == userId)
            .Select((user) => new AuthUser(user.Id, user.Email, user.PasswordHash))
            .SingleOrDefaultAsync(cancellationToken);
    }

    public Task<bool> ExistsByEmailAsync(string email, CancellationToken cancellationToken)
    {
        return dbContext.Users.AnyAsync((user) => user.Email == email, cancellationToken);
    }

    public Task AddUserAsync(AuthUser user, CancellationToken cancellationToken)
    {
        dbContext.Users.Add(new UserRecord
        {
            Id = user.Id,
            Email = user.Email,
            PasswordHash = user.PasswordHash,
            CreatedAtUtc = DateTimeOffset.UtcNow,
        });

        return dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> TryAddUserAsync(AuthUser user, CancellationToken cancellationToken)
    {
        try
        {
            await AddUserAsync(user, cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            if (await ExistsByEmailAsync(user.Email, cancellationToken))
            {
                return false;
            }

            throw;
        }
    }

    public Task UpdatePasswordHashAsync(string userId, string passwordHash, CancellationToken cancellationToken)
    {
        return dbContext.Users
            .Where((user) => user.Id == userId)
            .ExecuteUpdateAsync(
                (updates) => updates.SetProperty((user) => user.PasswordHash, passwordHash),
                cancellationToken);
    }
}
