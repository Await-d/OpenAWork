using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace OpenAWork.Gateway.Persistence.EFCore.Services;

public sealed class GatewayDatabaseInitializer(GatewayDbContext dbContext)
{
    private const string InitialMigrationId = "20260417085535_InitialCreate";

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        if (IsTestingEnvironment())
        {
            await dbContext.Database.EnsureDeletedAsync(cancellationToken);
        }

        await EnsureLegacyBaselineAsync(cancellationToken);

        try
        {
            await dbContext.Database.MigrateAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            if (!await ShouldRetryWithLegacyBaselineAsync(exception, cancellationToken))
            {
                throw;
            }

            await InsertInitialMigrationHistoryAsync(cancellationToken);
            await dbContext.Database.MigrateAsync(cancellationToken);
        }
    }

    private async Task EnsureLegacyBaselineAsync(CancellationToken cancellationToken)
    {
        var appliedMigrations = await dbContext.Database.GetAppliedMigrationsAsync(cancellationToken);
        if (appliedMigrations.Any())
        {
            return;
        }

        if (!await TableExistsAsync("request_workflow_logs", cancellationToken))
        {
            return;
        }

        await InsertInitialMigrationHistoryAsync(cancellationToken);
    }

    private async Task InsertInitialMigrationHistoryAsync(CancellationToken cancellationToken)
    {
        var productVersion = dbContext.Model.GetProductVersion() ?? "10.0.6";
        var sql = string.Join(
            Environment.NewLine,
            "CREATE TABLE IF NOT EXISTS \"__EFMigrationsHistory\" (\"MigrationId\" TEXT NOT NULL CONSTRAINT \"PK___EFMigrationsHistory\" PRIMARY KEY, \"ProductVersion\" TEXT NOT NULL);",
            $"INSERT OR IGNORE INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\") VALUES ('{InitialMigrationId}', '{productVersion}');");

        await dbContext.Database.ExecuteSqlRawAsync(sql, cancellationToken);
    }

    private async Task<bool> ShouldRetryWithLegacyBaselineAsync(Exception exception, CancellationToken cancellationToken)
    {
        if (!exception.Message.Contains("request_workflow_logs", StringComparison.OrdinalIgnoreCase)
            || !exception.Message.Contains("already exists", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var appliedMigrations = await dbContext.Database.GetAppliedMigrationsAsync(cancellationToken);
        return !appliedMigrations.Any();
    }

    private async Task<bool> TableExistsAsync(string tableName, CancellationToken cancellationToken)
    {
        var connection = dbContext.Database.GetDbConnection();
        var shouldClose = connection.State != System.Data.ConnectionState.Open;

        if (shouldClose)
        {
            await connection.OpenAsync(cancellationToken);
        }

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = dbContext.Database.ProviderName?.Contains("Sqlite", StringComparison.OrdinalIgnoreCase) == true
                ? "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $name;"
                : "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = @name;";

            var parameter = command.CreateParameter();
            parameter.ParameterName = dbContext.Database.ProviderName?.Contains("Sqlite", StringComparison.OrdinalIgnoreCase) == true ? "$name" : "@name";
            parameter.Value = tableName;
            command.Parameters.Add(parameter);

            var result = await command.ExecuteScalarAsync(cancellationToken);
            return Convert.ToInt32(result) > 0;
        }
        finally
        {
            if (shouldClose)
            {
                await connection.CloseAsync();
            }
        }
    }

    private static bool IsTestingEnvironment()
    {
        var aspnetEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        var dotnetEnvironment = Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT");

        return string.Equals(aspnetEnvironment, "Testing", StringComparison.OrdinalIgnoreCase)
            || string.Equals(dotnetEnvironment, "Testing", StringComparison.OrdinalIgnoreCase);
    }
}
