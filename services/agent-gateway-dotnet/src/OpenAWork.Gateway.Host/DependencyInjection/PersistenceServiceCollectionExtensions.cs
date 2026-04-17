using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Domain.Persistence;
using OpenAWork.Gateway.Persistence.PostgreSql;
using OpenAWork.Gateway.Persistence.Sqlite;

namespace OpenAWork.Gateway.Host.DependencyInjection;

public static class PersistenceServiceCollectionExtensions
{
    public static IServiceCollection AddGatewayPersistence(this IServiceCollection services, IConfiguration configuration)
    {
        var provider = DatabaseProviderParser.Parse(configuration["Database:Provider"]);

        return provider switch
        {
            DatabaseProviderKind.PostgreSql => services.AddGatewayPostgreSqlPersistence(configuration),
            _ => services.AddGatewaySqlitePersistence(configuration),
        };
    }
}
