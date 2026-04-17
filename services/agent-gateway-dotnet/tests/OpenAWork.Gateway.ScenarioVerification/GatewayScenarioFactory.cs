using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace OpenAWork.Gateway.ScenarioVerification;

public sealed class GatewayScenarioFactory : WebApplicationFactory<OpenAWork.Gateway.Host.Program>
{
    public string DatabasePath { get; private set; } = string.Empty;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        DatabasePath = Path.Combine(Path.GetTempPath(), $"openawork-gateway-scenario-{Guid.NewGuid():N}.db");
        Directory.CreateDirectory(Path.GetDirectoryName(DatabasePath)!);
        DeleteDatabaseArtifacts();

        builder.UseSetting("Database:Provider", "Sqlite");
        builder.UseSetting("OPENAWORK_DATABASE_PATH", DatabasePath);
        builder.UseSetting("ConnectionStrings:Sqlite", $"Data Source={DatabasePath}");
        builder.UseSetting("JWT_SECRET", "change-me-in-production-min-32-chars");
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, configurationBuilder) =>
        {
            configurationBuilder.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:Provider"] = "Sqlite",
                ["OPENAWORK_DATABASE_PATH"] = DatabasePath,
                ["ConnectionStrings:Sqlite"] = $"Data Source={DatabasePath}",
                ["JWT_SECRET"] = "change-me-in-production-min-32-chars",
            });
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        DeleteDatabaseArtifacts();
    }

    private void DeleteDatabaseArtifacts()
    {
        if (string.IsNullOrWhiteSpace(DatabasePath))
        {
            return;
        }

        foreach (var path in new[] { DatabasePath, $"{DatabasePath}-shm", $"{DatabasePath}-wal" })
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }
}
