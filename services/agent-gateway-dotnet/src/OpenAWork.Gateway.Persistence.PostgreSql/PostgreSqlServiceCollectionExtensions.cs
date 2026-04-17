using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Abstractions.Observability;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Readers;
using OpenAWork.Gateway.Persistence.EFCore.Services;
using OpenAWork.Gateway.Persistence.EFCore.Stores;
using OpenAWork.Gateway.Persistence.EFCore.Transactions;

namespace OpenAWork.Gateway.Persistence.PostgreSql;

public static class PostgreSqlServiceCollectionExtensions
{
    public static IServiceCollection AddGatewayPostgreSqlPersistence(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("PostgreSql")
            ?? throw new InvalidOperationException("ConnectionStrings:PostgreSql is required when Database:Provider=PostgreSql.");

        services.AddDbContext<GatewayDbContext>((options) =>
        {
            options.UseNpgsql(connectionString, (postgres) =>
            {
                postgres.MigrationsAssembly(typeof(PostgreSqlServiceCollectionExtensions).Assembly.GetName().Name);
            });
        });

        services.AddScoped<GatewayDatabaseInitializer>();
        services.AddScoped<ICommandTransactionRunner, GatewayCommandTransactionRunner>();
        services.AddScoped<IUserSettingsReader, UserSettingsReader>();
        services.AddScoped<IRequestWorkflowLogStore, RequestWorkflowLogStore>();
        return services;
    }
}
