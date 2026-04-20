namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public interface IRefreshTokenStore
{
    Task AddAsync(string userId, string tokenHash, DateTimeOffset expiresAtUtc, CancellationToken cancellationToken);

    Task<RefreshTokenEntry?> FindValidByHashAsync(string tokenHash, DateTimeOffset nowUtc, CancellationToken cancellationToken);

    Task<int> DeleteByHashAsync(string tokenHash, CancellationToken cancellationToken);

    Task<int> DeleteByUserIdAsync(string userId, CancellationToken cancellationToken);
}
