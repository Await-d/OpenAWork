using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Contracts.Auth;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class AuthEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public AuthEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Register_ShouldCreateUser_AndSeedDefaults()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest(
            Email: "register-user@openawork.local",
            Password: "password123"));
        var payload = await response.Content.ReadFromJsonAsync<RegisterResponse>();

        response.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(payload);
        Assert.True(payload.Ok);

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var user = await dbContext.Users.SingleAsync((candidate) => candidate.Email == "register-user@openawork.local");

        Assert.StartsWith("pbkdf2$", user.PasswordHash, StringComparison.Ordinal);
        Assert.Equal(2, await dbContext.InstalledSkills.CountAsync((skill) => skill.UserId == user.Id));
        Assert.Equal(4, await dbContext.WorkflowTemplates.CountAsync((template) => template.UserId == user.Id));
    }

    [Fact]
    public async Task Register_ShouldReturnTsStyleIssues_ForInvalidInput()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest(
            Email: string.Empty,
            Password: "x"));
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());

        var issues = payload.GetProperty("issues").EnumerateArray().ToArray();
        Assert.Contains(issues, (issue) => issue.GetProperty("path")[0].GetString() == "email");
        Assert.Contains(issues, (issue) => issue.GetProperty("path")[0].GetString() == "password");
        Assert.DoesNotContain(issues, (issue) => issue.GetProperty("path")[0].GetString() == "Email");
        Assert.DoesNotContain(issues, (issue) => issue.GetProperty("path")[0].GetString() == "Password");
    }

    [Fact]
    public async Task Register_ShouldReturnTsStyleIssues_ForTypeMismatchInput()
    {
        using var client = _factory.CreateClient();
        using var content = new StringContent("{\"email\":123,\"password\":true}", Encoding.UTF8, "application/json");

        var response = await client.PostAsync("/auth/register", content);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());

        var issues = payload.GetProperty("issues").EnumerateArray().ToArray();
        Assert.Contains(issues, (issue) => issue.GetProperty("path")[0].GetString() == "email" && issue.GetProperty("received").GetString() == "number");
        Assert.Contains(issues, (issue) => issue.GetProperty("path")[0].GetString() == "password" && issue.GetProperty("received").GetString() == "boolean");
    }

    [Fact]
    public async Task Register_ShouldRejectOversizedPassword()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest(
            Email: "oversized-password@openawork.local",
            Password: new string('p', 1025)));
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());
        Assert.Contains(payload.GetProperty("issues").EnumerateArray(), (issue) => issue.GetProperty("path")[0].GetString() == "password");
    }

    [Fact]
    public async Task Register_ShouldRejectPayloadsLargerThanAuthBodyLimit()
    {
        using var client = _factory.CreateClient();
        using var content = new StringContent($"{{\"email\":\"oversized@openawork.local\",\"password\":\"{new string('p', 17000)}\"}}", Encoding.UTF8, "application/json");

        var response = await client.PostAsync("/auth/register", content);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal((HttpStatusCode)413, response.StatusCode);
        Assert.Equal("Payload too large", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Register_ShouldReturnConflict_WhenEmailAlreadyExists()
    {
        await SeedUserAsync("duplicate-user", "duplicate@openawork.local", "password123");
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest(
            Email: "duplicate@openawork.local",
            Password: "password123"));
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("Email already registered", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Login_ShouldReturnTokens_AndPersistRefreshToken()
    {
        await SeedUserAsync("login-user", "login@openawork.local", "password123");
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest(
            Email: "login@openawork.local",
            Password: "password123"));
        var payload = await response.Content.ReadFromJsonAsync<LoginResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.False(string.IsNullOrWhiteSpace(payload.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(payload.RefreshToken));
        Assert.Equal("15m", payload.ExpiresIn);

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var tokenCount = await dbContext.RefreshTokens.CountAsync((token) => token.UserId == "login-user");
        Assert.Equal(1, tokenCount);
    }

    [Fact]
    public async Task Login_ShouldRejectInvalidCredentials()
    {
        await SeedUserAsync("invalid-user", "invalid@openawork.local", "password123");
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest(
            Email: "invalid@openawork.local",
            Password: "wrong-password"));
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Invalid credentials", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Refresh_ShouldRotateRefreshToken()
    {
        await SeedUserAsync("refresh-user", "refresh@openawork.local", "password123");
        using var client = _factory.CreateClient();

        var loginResponse = await client.PostAsJsonAsync("/auth/login", new LoginRequest(
            Email: "refresh@openawork.local",
            Password: "password123"));
        var loginPayload = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>();
        loginResponse.EnsureSuccessStatusCode();

        var refreshResponse = await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest(loginPayload!.RefreshToken));
        var refreshPayload = await refreshResponse.Content.ReadFromJsonAsync<RefreshResponse>();

        refreshResponse.EnsureSuccessStatusCode();
        Assert.NotNull(refreshPayload);
        Assert.NotEqual(loginPayload.RefreshToken, refreshPayload.RefreshToken);

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var tokens = await dbContext.RefreshTokens.Where((token) => token.UserId == "refresh-user").ToListAsync();

        Assert.Single(tokens);
        Assert.Equal(HashPassword(refreshPayload.RefreshToken), tokens[0].TokenHash);
    }

    [Fact]
    public async Task Refresh_ShouldTreatEmptyString_AsUnauthorized()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest(string.Empty));
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Invalid or expired refresh token", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Refresh_ShouldReturnTsStyleIssues_ForTypeMismatchInput()
    {
        using var client = _factory.CreateClient();
        using var content = new StringContent("{\"refreshToken\":123}", Encoding.UTF8, "application/json");

        var response = await client.PostAsync("/auth/refresh", content);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());
        Assert.Equal("refreshToken", payload.GetProperty("issues")[0].GetProperty("path")[0].GetString());
        Assert.Equal("number", payload.GetProperty("issues")[0].GetProperty("received").GetString());
    }

    [Fact]
    public async Task Refresh_ShouldRejectOversizedToken()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest(new string('r', 4097)));
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());
        Assert.Equal("refreshToken", payload.GetProperty("issues")[0].GetProperty("path")[0].GetString());
    }

    [Fact]
    public async Task Logout_ShouldDeleteRefreshTokens_ForAuthenticatedUser()
    {
        await SeedUserAsync("logout-user", "logout@openawork.local", "password123");
        await SeedRefreshTokenAsync("logout-user", "existing-token");

        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create("logout-user", "logout@openawork.local"));

        var response = await client.PostAsync("/auth/logout", content: null);
        var payload = await response.Content.ReadFromJsonAsync<LogoutResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.True(payload.Ok);

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        Assert.Equal(0, await dbContext.RefreshTokens.CountAsync((token) => token.UserId == "logout-user"));
    }

    [Fact]
    public async Task Logout_ShouldReturnJsonUnauthorized_WhenMissingBearerToken()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsync("/auth/logout", content: null);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Unauthorized", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task DefaultAdmin_ShouldBeSeeded_AndAllowLogin()
    {
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            var hasher = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Auth.IPasswordHasher>();
            var admin = await dbContext.Users.SingleOrDefaultAsync((user) => user.Email == "admin@openAwork.local");

            Assert.NotNull(admin);
            Assert.True(hasher.Verify("admin123456", admin.PasswordHash));
        }

        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest(
            Email: "admin@openAwork.local",
            Password: "admin123456"));
        var payload = await response.Content.ReadFromJsonAsync<LoginResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.False(string.IsNullOrWhiteSpace(payload.AccessToken));
    }

    [Fact]
    public async Task Bootstrapper_ShouldTolerateDuplicateSeedKeys()
    {
        const string userId = "duplicate-seed-user";
        await SeedUserAsync(userId, "duplicate-seed@openawork.local", "password123");

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

            dbContext.WorkflowTemplates.AddRange(
                new WorkflowTemplateRecord
                {
                    Id = Guid.NewGuid().ToString(),
                    UserId = userId,
                    Name = "dup-a",
                    Description = "a",
                    Category = "team-playbook",
                    MetadataJson = "{\"seedKey\":\"dev-team-medium\"}",
                    NodesJson = "[]",
                    EdgesJson = "[]",
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                    UpdatedAtUtc = DateTimeOffset.UtcNow,
                },
                new WorkflowTemplateRecord
                {
                    Id = Guid.NewGuid().ToString(),
                    UserId = userId,
                    Name = "dup-b",
                    Description = "b",
                    Category = "team-playbook",
                    MetadataJson = "{\"seedKey\":\"dev-team-medium\"}",
                    NodesJson = "[]",
                    EdgesJson = "[]",
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                    UpdatedAtUtc = DateTimeOffset.UtcNow,
                });

            await dbContext.SaveChangesAsync();
        }

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var bootstrapper = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Auth.IUserRegistrationBootstrapper>();
            await bootstrapper.EnsureDefaultsForUserAsync(userId, CancellationToken.None);
        }
    }

    [Fact]
    public void Startup_ShouldFailClosed_WhenJwtIssuerOrAudienceIsMissing()
    {
        using var failingFactory = new MissingJwtSettingsFactory();

        var exception = Assert.Throws<InvalidOperationException>(() => failingFactory.CreateClient());
        Assert.Contains("JWT_ISSUER is required", exception.ToString(), StringComparison.Ordinal);
    }

    private async Task SeedUserAsync(string userId, string email, string password)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

        dbContext.Users.Add(new UserRecord
        {
            Id = userId,
            Email = email,
            PasswordHash = HashPassword(password),
            CreatedAtUtc = DateTimeOffset.UtcNow,
        });

        await dbContext.SaveChangesAsync();
    }

    private async Task SeedRefreshTokenAsync(string userId, string plainToken)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

        dbContext.RefreshTokens.Add(new RefreshTokenRecord
        {
            Id = Guid.NewGuid().ToString(),
            UserId = userId,
            TokenHash = HashPassword(plainToken),
            ExpiresAtUtc = DateTimeOffset.UtcNow.AddDays(7),
        });

        await dbContext.SaveChangesAsync();
    }

    private static string HashPassword(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private sealed class MissingJwtSettingsFactory : WebApplicationFactory<OpenAWork.Gateway.Host.Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            var databasePath = Path.Combine(Path.GetTempPath(), $"openawork-gateway-missing-jwt-{Guid.NewGuid():N}.db");
            builder.UseSetting("Database:Provider", "Sqlite");
            builder.UseSetting("OPENAWORK_DATABASE_PATH", databasePath);
            builder.UseSetting("ConnectionStrings:Sqlite", $"Data Source={databasePath}");
            builder.UseSetting("JWT_SECRET", "change-me-in-production-min-32-chars");
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, configurationBuilder) =>
            {
                configurationBuilder.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:Provider"] = "Sqlite",
                    ["OPENAWORK_DATABASE_PATH"] = databasePath,
                    ["ConnectionStrings:Sqlite"] = $"Data Source={databasePath}",
                    ["JWT_SECRET"] = "change-me-in-production-min-32-chars",
                    ["JWT_ISSUER"] = string.Empty,
                    ["JWT_AUDIENCE"] = string.Empty,
                });
            });
        }
    }
}
