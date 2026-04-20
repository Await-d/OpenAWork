using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using OpenAWork.Gateway.Application.Abstractions.Auth;

namespace OpenAWork.Gateway.Infrastructure.Auth;

public sealed class JwtTokenIssuer : IJwtTokenIssuer
{
    private const string DefaultJwtExpiresIn = "15m";

    private readonly SigningCredentials _signingCredentials;
    private readonly TimeSpan _tokenLifetime;
    private readonly string _issuer;
    private readonly string _audience;

    public JwtTokenIssuer(IConfiguration configuration)
    {
        ExpiresIn = configuration["JWT_EXPIRES_IN"] ?? DefaultJwtExpiresIn;
        _tokenLifetime = ParseLifetime(ExpiresIn);
        _issuer = JwtConfiguration.ResolveJwtIssuer(configuration);
        _audience = JwtConfiguration.ResolveJwtAudience(configuration);

        var secret = JwtConfiguration.ResolveJwtSecret(configuration);
        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        _signingCredentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);
    }

    public string ExpiresIn { get; }

    public string IssueAccessToken(string userId, string email)
    {
        var now = DateTimeOffset.UtcNow;
        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, userId),
                new Claim(JwtRegisteredClaimNames.Email, email),
            ],
            notBefore: now.UtcDateTime,
            expires: now.Add(_tokenLifetime).UtcDateTime,
            signingCredentials: _signingCredentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static TimeSpan ParseLifetime(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return TimeSpan.FromMinutes(15);
        }

        var trimmed = value.Trim();
        if (TimeSpan.TryParse(trimmed, out var parsed))
        {
            return parsed;
        }

        var unit = trimmed[^1];
        if (!int.TryParse(trimmed[..^1], out var amount))
        {
            throw new InvalidOperationException($"Unsupported JWT_EXPIRES_IN value '{value}'.");
        }

        return unit switch
        {
            's' or 'S' => TimeSpan.FromSeconds(amount),
            'm' or 'M' => TimeSpan.FromMinutes(amount),
            'h' or 'H' => TimeSpan.FromHours(amount),
            'd' or 'D' => TimeSpan.FromDays(amount),
            _ => throw new InvalidOperationException($"Unsupported JWT_EXPIRES_IN unit '{unit}'."),
        };
    }
}
