using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Data.Sqlite;
using OpenAWork.Gateway.Application.Abstractions.Observability;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Readers;
using OpenAWork.Gateway.Persistence.EFCore.Services;
using OpenAWork.Gateway.Persistence.EFCore.Stores;
using OpenAWork.Gateway.Persistence.EFCore.Transactions;

namespace OpenAWork.Gateway.Persistence.Sqlite;

public static class SqliteServiceCollectionExtensions
{
    public static IServiceCollection AddGatewaySqlitePersistence(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = ResolveConnectionString(configuration);
        EnsureDatabaseDirectory(connectionString);

        services.AddDbContext<GatewayDbContext>((options) =>
        {
            options.UseSqlite(connectionString, (sqlite) =>
            {
                sqlite.MigrationsAssembly(typeof(SqliteServiceCollectionExtensions).Assembly.GetName().Name);
            });
        });

        services.AddScoped<GatewayDatabaseInitializer>();
        services.AddScoped<ICommandTransactionRunner, GatewayCommandTransactionRunner>();
        services.AddScoped<IUserAuthStore, UserAuthStore>();
        services.AddScoped<IRefreshTokenStore, RefreshTokenStore>();
        services.AddScoped<IUserRegistrationBootstrapper, UserRegistrationBootstrapper>();
        services.AddScoped<IUserSettingsReader, UserSettingsReader>();
        services.AddScoped<IUserSettingsWriter, UserSettingsWriter>();
        services.AddScoped<IInstalledSkillReader, InstalledSkillReader>();
        services.AddScoped<IRequestWorkflowLogStore, RequestWorkflowLogStore>();
        services.AddScoped<IMessageV2Store, MessageV2Store>();
        services.AddScoped<ISyncEventStore, SyncEventStore>();
        services.AddScoped<ISessionRunEventStore, SessionRunEventStore>();
        services.AddScoped<ISessionRuntimeThreadStore, SessionRuntimeThreadStore>();
        services.AddScoped<IPermissionRequestStore, PermissionRequestStore>();
        services.AddScoped<IQuestionRequestStore, QuestionRequestStore>();
        services.AddScoped<ITaskParentAutoResumeContextStore, TaskParentAutoResumeContextStore>();
        return services;
    }

    public static string ResolveConnectionString(IConfiguration configuration)
    {
        var explicitPath = configuration["OPENAWORK_DATABASE_PATH"] ?? configuration["DATABASE_URL"];
        if (!string.IsNullOrWhiteSpace(explicitPath))
        {
            return $"Data Source={explicitPath}";
        }

        var configuredConnectionString = configuration.GetConnectionString("Sqlite");
        if (!string.IsNullOrWhiteSpace(configuredConnectionString))
        {
            return configuredConnectionString;
        }

        var dataDir = configuration["OPENAWORK_DATA_DIR"];
        if (string.IsNullOrWhiteSpace(dataDir))
        {
            dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenAWork", "agent-gateway-dotnet");
        }

        Directory.CreateDirectory(dataDir);
        var databasePath = Path.Combine(dataDir, "openawork-gateway-dotnet.db");
        return $"Data Source={databasePath}";
    }

    private static void EnsureDatabaseDirectory(string connectionString)
    {
        var builder = new SqliteConnectionStringBuilder(connectionString);
        var dataSource = builder.DataSource;

        if (string.IsNullOrWhiteSpace(dataSource) || dataSource == ":memory:" || dataSource.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var fullPath = Path.GetFullPath(dataSource);
        var directory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }
    }
}
