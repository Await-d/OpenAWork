namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public interface IUserAuthStore
{
    Task<AuthUser?> FindByEmailAsync(string email, CancellationToken cancellationToken);

    Task<AuthUser?> FindByIdAsync(string userId, CancellationToken cancellationToken);

    Task<bool> ExistsByEmailAsync(string email, CancellationToken cancellationToken);

    Task AddUserAsync(AuthUser user, CancellationToken cancellationToken);

    Task<bool> TryAddUserAsync(AuthUser user, CancellationToken cancellationToken);

    Task UpdatePasswordHashAsync(string userId, string passwordHash, CancellationToken cancellationToken);
}
