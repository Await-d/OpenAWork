using Microsoft.Extensions.Configuration;

namespace OpenAWork.Gateway.Infrastructure.Auth;

public static class JwtConfiguration
{
    public static string ResolveJwtSecret(IConfiguration configuration)
    {
        var secret = configuration["JWT_SECRET"];
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32)
        {
            throw new InvalidOperationException("JWT_SECRET is required and must be at least 32 characters.");
        }

        return secret;
    }

    public static string ResolveJwtIssuer(IConfiguration configuration)
    {
        var issuer = configuration["JWT_ISSUER"];
        if (string.IsNullOrWhiteSpace(issuer))
        {
            throw new InvalidOperationException("JWT_ISSUER is required.");
        }

        return issuer;
    }

    public static string ResolveJwtAudience(IConfiguration configuration)
    {
        var audience = configuration["JWT_AUDIENCE"];
        if (string.IsNullOrWhiteSpace(audience))
        {
            throw new InvalidOperationException("JWT_AUDIENCE is required.");
        }

        return audience;
    }
}
