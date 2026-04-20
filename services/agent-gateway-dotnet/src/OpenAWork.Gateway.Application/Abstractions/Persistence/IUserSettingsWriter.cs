namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface IUserSettingsWriter
{
    Task UpsertAsync(string userId, string key, string value, CancellationToken cancellationToken);
}
