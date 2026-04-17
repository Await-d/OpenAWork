using OpenAWork.Gateway.Domain.Errors;

namespace OpenAWork.Gateway.Domain.Persistence;

public static class DatabaseProviderParser
{
    public static DatabaseProviderKind Parse(string? provider)
    {
        if (string.IsNullOrWhiteSpace(provider))
        {
            return DatabaseProviderKind.Sqlite;
        }

        return provider.Trim().ToLowerInvariant() switch
        {
            "sqlite" => DatabaseProviderKind.Sqlite,
            "postgresql" => DatabaseProviderKind.PostgreSql,
            "postgres" => DatabaseProviderKind.PostgreSql,
            _ => throw new UnknownDatabaseProviderException(provider),
        };
    }
}
