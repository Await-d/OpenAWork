using System.Security.Cryptography;
using System.Text;
using OpenAWork.Gateway.Application.Abstractions.Auth;

namespace OpenAWork.Gateway.Infrastructure.Auth;

public sealed class RefreshTokenFactory : IRefreshTokenFactory
{
    private static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(7);

    public string Hash(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    public GeneratedRefreshToken Create()
    {
        var tokenBytes = RandomNumberGenerator.GetBytes(48);
        var token = Base64UrlEncode(tokenBytes);

        return new GeneratedRefreshToken(
            Token: token,
            TokenHash: Hash(token),
            ExpiresAtUtc: DateTimeOffset.UtcNow.Add(RefreshLifetime));
    }

    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}
