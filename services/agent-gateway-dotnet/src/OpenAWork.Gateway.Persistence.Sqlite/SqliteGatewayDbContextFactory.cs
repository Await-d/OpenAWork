using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.Persistence.Sqlite;

public sealed class SqliteGatewayDbContextFactory : IDesignTimeDbContextFactory<GatewayDbContext>
{
    public GatewayDbContext CreateDbContext(string[] args)
    {
        var configuration = new ConfigurationBuilder()
            .AddJsonFile("appsettings.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var optionsBuilder = new DbContextOptionsBuilder<GatewayDbContext>();
        optionsBuilder.UseSqlite(SqliteServiceCollectionExtensions.ResolveConnectionString(configuration));
        return new GatewayDbContext(optionsBuilder.Options);
    }
}
