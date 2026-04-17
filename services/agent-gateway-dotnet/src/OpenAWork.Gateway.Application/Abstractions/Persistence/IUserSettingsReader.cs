namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface IUserSettingsReader
{
    Task<string?> GetValueAsync(string userId, string key, CancellationToken cancellationToken);
}
