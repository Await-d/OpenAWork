namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public interface IUserRegistrationBootstrapper
{
    Task EnsureDefaultsForUserAsync(string userId, CancellationToken cancellationToken);

    Task EnsureDefaultsForAllUsersAsync(CancellationToken cancellationToken);
}
