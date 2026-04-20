using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using System.Security.Cryptography;
using System.Text;

namespace OpenAWork.Gateway.Infrastructure.Auth;

public sealed class DefaultAdminSeeder(
    IConfiguration configuration,
    IHostEnvironment hostEnvironment,
    IUserAuthStore userAuthStore,
    IPasswordHasher passwordHasher) : IDefaultAdminSeeder
{
    private const string DefaultAdminEmail = "admin@openAwork.local";
    private const string DefaultAdminPassword = "admin123456";

    public async Task SeedAsync(CancellationToken cancellationToken)
    {
        var configuredEmail = configuration["ADMIN_EMAIL"];
        var configuredPassword = configuration["ADMIN_PASSWORD"];
        var isNonDevelopmentEnvironment = !hostEnvironment.IsDevelopment() && !hostEnvironment.IsEnvironment("Testing");

        if (isNonDevelopmentEnvironment && string.IsNullOrWhiteSpace(configuredEmail) && string.IsNullOrWhiteSpace(configuredPassword))
        {
            return;
        }

        if (isNonDevelopmentEnvironment && (string.IsNullOrWhiteSpace(configuredEmail) || string.IsNullOrWhiteSpace(configuredPassword)))
        {
            throw new InvalidOperationException("ADMIN_EMAIL and ADMIN_PASSWORD must be configured together outside Development/Testing.");
        }

        var adminEmail = string.IsNullOrWhiteSpace(configuredEmail) ? DefaultAdminEmail : configuredEmail;
        var adminPassword = string.IsNullOrWhiteSpace(configuredPassword) ? DefaultAdminPassword : configuredPassword;

        if (await userAuthStore.ExistsByEmailAsync(adminEmail, cancellationToken))
        {
            return;
        }

        var added = await userAuthStore.TryAddUserAsync(new AuthUser(
            Id: Guid.NewGuid().ToString(),
            Email: adminEmail,
            PasswordHash: passwordHasher.HashPassword(adminPassword)),
            cancellationToken);

        if (!added)
        {
            return;
        }
    }
}
